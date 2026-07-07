// audio.rs — одновременный захват микрофона и BlackHole в два WAV-файла.
// Консервативный подход: пишем WAV на диск, транскрипция после Stop (MVP).
// ВНИМАНИЕ ДЛЯ АГЕНТА (Claude Code): этот файл требует локальной проверки на macOS —
// имена устройств, sample rate и формат могут отличаться. Тестируй через `list_devices`.

use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound::{WavSpec, WavWriter};
use parking_lot::Mutex;
use std::fs::File;
use std::io::BufWriter;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub struct Recorder {
    running: Arc<AtomicBool>,
    streams: Vec<cpal::Stream>,
}

pub struct RecorderHandles {
    pub mic_path: String,
    pub sys_path: String,
}

/// Список input-устройств — фронт показывает их в настройках.
pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|it| it.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

fn find_device(host: &cpal::Host, name_substr: &str) -> Result<cpal::Device> {
    host.input_devices()?
        .find(|d| {
            d.name()
                .map(|n| n.to_lowercase().contains(&name_substr.to_lowercase()))
                .unwrap_or(false)
        })
        .ok_or_else(|| anyhow!("Устройство, содержащее '{}' в имени, не найдено", name_substr))
}

fn build_wav_writer(path: &str, sample_rate: u32, channels: u16) -> Result<Arc<Mutex<Option<WavWriter<BufWriter<File>>>>>> {
    let spec = WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    Ok(Arc::new(Mutex::new(Some(WavWriter::create(path, spec)?))))
}

fn spawn_capture(
    device: cpal::Device,
    path: String,
    running: Arc<AtomicBool>,
) -> Result<cpal::Stream> {
    let config = device.default_input_config()?;
    let sample_rate = config.sample_rate().0;
    let channels = config.channels();
    let writer = build_wav_writer(&path, sample_rate, channels)?;
    let writer_cb = writer.clone();
    let running_cb = running.clone();

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _| {
                if !running_cb.load(Ordering::Relaxed) {
                    return;
                }
                if let Some(w) = writer_cb.lock().as_mut() {
                    for &s in data {
                        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                        let _ = w.write_sample(v);
                    }
                }
            },
            |e| eprintln!("stream error: {e}"),
            None,
        )?,
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], _| {
                if !running_cb.load(Ordering::Relaxed) {
                    return;
                }
                if let Some(w) = writer_cb.lock().as_mut() {
                    for &s in data {
                        let _ = w.write_sample(s);
                    }
                }
            },
            |e| eprintln!("stream error: {e}"),
            None,
        )?,
        f => return Err(anyhow!("Неподдерживаемый формат сэмплов: {f:?}")),
    };
    stream.play()?;

    // Финализация writer при остановке произойдёт в Recorder::stop через drop стрима +
    // отдельный finalize. Храним writer в глобальном реестре простоты ради:
    WRITERS.lock().push((path, writer));
    Ok(stream)
}

// Реестр открытых writer'ов, чтобы корректно финализировать WAV-заголовки при stop.
static WRITERS: Mutex<Vec<(String, Arc<Mutex<Option<WavWriter<BufWriter<File>>>>>)>> =
    Mutex::new(Vec::new());

// cpal::Stream on CoreAudio is !Send due to FnMut callback wrappers, but our callbacks
// only capture Arc<AtomicBool> and Arc<Mutex<...>> which are Send. After play() is called
// we never call Stream methods from multiple threads — Mutex in AppState serialises access.
unsafe impl Send for Recorder {}

impl Recorder {
    /// mic_hint — подстрока имени микрофона (напр. "AirPods"), sys_hint — "BlackHole".
    pub fn start(mic_hint: &str, sys_hint: &str, out_dir: &str) -> Result<(Self, RecorderHandles)> {
        std::fs::create_dir_all(out_dir)?;
        let ts = chrono::Local::now().format("%Y-%m-%d_%H%M%S");
        let mic_path = format!("{out_dir}/{ts}_mic.wav");
        let sys_path = format!("{out_dir}/{ts}_sys.wav");

        let host = cpal::default_host();
        let running = Arc::new(AtomicBool::new(true));

        let mic_dev = find_device(&host, mic_hint)?;
        let sys_dev = find_device(&host, sys_hint)?;

        let s1 = spawn_capture(mic_dev, mic_path.clone(), running.clone())?;
        let s2 = spawn_capture(sys_dev, sys_path.clone(), running.clone())?;

        Ok((
            Recorder { running, streams: vec![s1, s2] },
            RecorderHandles { mic_path, sys_path },
        ))
    }

    pub fn pause(&self) {
        self.running.store(false, Ordering::Relaxed);
    }

    pub fn resume(&self) {
        self.running.store(true, Ordering::Relaxed);
    }

    pub fn stop(self) -> Result<()> {
        self.running.store(false, Ordering::Relaxed);
        drop(self.streams);
        // Финализируем все WAV (пишет корректный заголовок с длиной).
        for (_, w) in WRITERS.lock().drain(..) {
            if let Some(writer) = w.lock().take() {
                writer.finalize()?;
            }
        }
        Ok(())
    }
}
