// whisper.rs — транскрипция через whisper.cpp CLI (whisper-cli).
// Сознательно НЕ используем rust-биндинги: CLI стабильнее, проще обновлять модель,
// и Metal-ускорение работает из коробки в официальном билде whisper.cpp.
//
// Требование к окружению (описано в README):
//   brew install whisper-cpp
//   модель скачивается в ./models/ggml-large-v3-turbo.bin

use anyhow::{anyhow, Result};
use hound::WavReader;
use serde::{Deserialize, Serialize};
use std::process::Command;

// RMS < 0.01 от пика i16 (~328 из 32768) — считаем тишиной.
// Порог подобран так чтобы отсекать пустой BlackHole и тихий фон,
// но не трогать тихую речь (RMS речи обычно > 0.03).
const SILENCE_RMS_THRESHOLD: f64 = 0.01;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Segment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub speaker: String, // "Я" | "Собеседники"
    pub text: String,
}

/// Возвращает нормализованный RMS [0.0, 1.0] по всем сэмплам WAV.
/// Поддерживает i16 и f32 треки; всё остальное → 0.0.
fn wav_rms(wav_path: &str) -> f64 {
    let Ok(mut reader) = WavReader::open(wav_path) else {
        return 0.0;
    };
    let spec = reader.spec();
    match spec.sample_format {
        hound::SampleFormat::Int => {
            let peak = (1i64 << (spec.bits_per_sample - 1)) as f64;
            let mut sum = 0f64;
            let mut count = 0u64;
            for s in reader.samples::<i32>().flatten() {
                sum += (s as f64 / peak).powi(2);
                count += 1;
            }
            if count == 0 { 0.0 } else { (sum / count as f64).sqrt() }
        }
        hound::SampleFormat::Float => {
            let mut sum = 0f64;
            let mut count = 0u64;
            for s in reader.samples::<f32>().flatten() {
                sum += (s as f64).powi(2);
                count += 1;
            }
            if count == 0 { 0.0 } else { (sum / count as f64).sqrt() }
        }
    }
}

/// Запускает whisper-cli на одном WAV и возвращает сегменты с меткой спикера.
/// Если WAV тихий/пустой — возвращает пустой вектор без запуска whisper.
pub fn transcribe(wav_path: &str, model_path: &str, speaker: &str, language: &str) -> Result<Vec<Segment>> {
    let rms = wav_rms(wav_path);
    eprintln!("VAD rms({speaker})={rms:.4}");
    if rms < SILENCE_RMS_THRESHOLD {
        eprintln!("VAD: тишина на канале {speaker}, пропускаем whisper");
        return Ok(vec![]);
    }

    // -oj => вывод JSON рядом с wav (file.wav.json)
    let output = Command::new("whisper-cli")
        .args([
            "-m", model_path,
            "-f", wav_path,
            "-l", language, // "auto" для автоопределения ru/en
            "-oj",
            "-np", // без прогресс-принтов
        ])
        .output()
        .map_err(|e| anyhow!("Не удалось запустить whisper-cli (установлен ли brew install whisper-cpp?): {e}"))?;

    if !output.status.success() {
        return Err(anyhow!(
            "whisper-cli завершился с ошибкой: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let json_path = format!("{wav_path}.json");
    let raw = std::fs::read_to_string(&json_path)?;
    let parsed: WhisperJson = serde_json::from_str(&raw)?;

    Ok(parsed
        .transcription
        .into_iter()
        .map(|t| Segment {
            start_ms: t.offsets.from,
            end_ms: t.offsets.to,
            speaker: speaker.to_string(),
            text: t.text.trim().to_string(),
        })
        .filter(|s| !s.text.is_empty())
        .collect())
}

/// Сливает два потока сегментов (mic + system) в единую хронологию.
pub fn merge(mut a: Vec<Segment>, b: Vec<Segment>) -> Vec<Segment> {
    a.extend(b);
    a.sort_by_key(|s| s.start_ms);
    a
}

// --- структуры под формат вывода whisper.cpp -oj ---
#[derive(Deserialize)]
struct WhisperJson {
    transcription: Vec<WhisperSeg>,
}
#[derive(Deserialize)]
struct WhisperSeg {
    offsets: Offsets,
    text: String,
}
#[derive(Deserialize)]
struct Offsets {
    from: u64,
    to: u64,
}
