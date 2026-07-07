// lib.rs — Tauri-команды, связывающие frontend и аудио/транскрипцию.

mod audio;
mod export;
mod whisper;

use audio::{Recorder, RecorderHandles};
use parking_lot::Mutex;
use serde::Serialize;
use whisper::Segment;

struct AppState {
    recorder: Mutex<Option<(Recorder, RecorderHandles)>>,
}

#[derive(Serialize)]
struct TranscriptResult {
    segments: Vec<Segment>,
    saved_path: String,
}

#[tauri::command]
fn list_devices() -> Vec<String> {
    audio::list_input_devices()
}

#[tauri::command]
fn start_recording(
    state: tauri::State<AppState>,
    mic_hint: String,
    sys_hint: String,
) -> Result<String, String> {
    let (rec, handles) =
        Recorder::start(&mic_hint, &sys_hint, "recordings").map_err(|e| e.to_string())?;
    let msg = format!("Запись: {} + {}", handles.mic_path, handles.sys_path);
    *state.recorder.lock() = Some((rec, handles));
    Ok(msg)
}

#[tauri::command]
fn pause_recording(state: tauri::State<AppState>) -> Result<(), String> {
    if let Some((rec, _)) = state.recorder.lock().as_ref() {
        rec.pause();
        Ok(())
    } else {
        Err("Нет активной записи".into())
    }
}

#[tauri::command]
fn resume_recording(state: tauri::State<AppState>) -> Result<(), String> {
    if let Some((rec, _)) = state.recorder.lock().as_ref() {
        rec.resume();
        Ok(())
    } else {
        Err("Нет активной записи".into())
    }
}

#[tauri::command]
fn stop_and_transcribe(
    state: tauri::State<AppState>,
    model_path: String,
    vault_dir: String,
    duration_min: u64,
) -> Result<TranscriptResult, String> {
    let (rec, handles) = state
        .recorder
        .lock()
        .take()
        .ok_or("Нет активной записи")?;
    rec.stop().map_err(|e| e.to_string())?;

    let me = whisper::transcribe(&handles.mic_path, &model_path, "Я", "auto")
        .map_err(|e| e.to_string())?;
    let them = whisper::transcribe(&handles.sys_path, &model_path, "Собеседники", "auto")
        .map_err(|e| e.to_string())?;
    let segments = whisper::merge(me, them);

    let saved_path = export::save_to_vault(&vault_dir, &segments, duration_min)
        .map_err(|e| e.to_string())?;

    Ok(TranscriptResult { segments, saved_path })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState { recorder: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            list_devices,
            start_recording,
            pause_recording,
            resume_recording,
            stop_and_transcribe
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
