// whisper.rs — транскрипция через whisper.cpp CLI (whisper-cli).
// Сознательно НЕ используем rust-биндинги: CLI стабильнее, проще обновлять модель,
// и Metal-ускорение работает из коробки в официальном билде whisper.cpp.
//
// Требование к окружению (описано в README):
//   brew install whisper-cpp
//   модель скачивается в ./models/ggml-large-v3-turbo.bin

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Segment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub speaker: String, // "Я" | "Собеседники"
    pub text: String,
}

/// Запускает whisper-cli на одном WAV и возвращает сегменты с меткой спикера.
pub fn transcribe(wav_path: &str, model_path: &str, speaker: &str, language: &str) -> Result<Vec<Segment>> {
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
