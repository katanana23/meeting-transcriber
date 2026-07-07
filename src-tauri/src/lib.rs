mod audio;
mod export;
mod summary;
mod whisper;

use audio::{Recorder, RecorderHandles};
use parking_lot::Mutex;
use serde::Serialize;
use whisper::Segment;

fn expand_path(p: &str) -> String {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    p.to_string()
}

struct AppState {
    recorder: Mutex<Option<(Recorder, RecorderHandles)>>,
}

#[derive(Serialize)]
struct TranscriptResult {
    segments: Vec<Segment>,
    saved_path: String,
}

#[derive(Serialize)]
struct MeetingMeta {
    path: String,
    filename: String,
    date: String,
    duration_min: u64,
    preview: String,
    title: String,
}

fn parse_frontmatter(content: &str) -> (String, u64, String) {
    let mut date = String::new();
    let mut duration_min = 0u64;
    let mut title = String::new();
    if !content.starts_with("---\n") {
        return (date, duration_min, title);
    }
    if let Some(end) = content[4..].find("\n---") {
        let fm = &content[4..4 + end];
        for line in fm.lines() {
            if let Some(v) = line.strip_prefix("date: ") {
                date = v.trim().to_string();
            }
            if let Some(v) = line.strip_prefix("duration: ") {
                duration_min = v.trim().trim_end_matches('m').parse().unwrap_or(0);
            }
            if let Some(v) = line.strip_prefix("title: ") {
                title = v.trim().to_string();
            }
        }
    }
    (date, duration_min, title)
}

fn extract_preview(content: &str) -> String {
    // Find first **[time] speaker:** text pattern and return the text part
    if let Some(start) = content.find("**[") {
        if let Some(colon) = content[start..].find(":** ") {
            let text_start = start + colon + 4;
            return content[text_start..]
                .chars()
                .take(100)
                .collect::<String>()
                .trim_end_matches('\n')
                .to_string();
        }
    }
    String::new()
}

#[tauri::command]
fn list_meetings(vault_dir: String) -> Vec<MeetingMeta> {
    let vault_dir = expand_path(&vault_dir);
    let Ok(entries) = std::fs::read_dir(&vault_dir) else {
        return vec![];
    };

    let mut meetings: Vec<MeetingMeta> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.ends_with("_meeting.md"))
                .unwrap_or(false)
        })
        .filter_map(|e| {
            let path = e.path();
            let content = std::fs::read_to_string(&path).ok()?;
            let filename = path.file_name()?.to_str()?.to_string();
            let (date, duration_min, title) = parse_frontmatter(&content);
            let preview = extract_preview(&content);
            Some(MeetingMeta {
                path: path.to_str()?.to_string(),
                filename,
                date,
                duration_min,
                preview,
                title,
            })
        })
        .collect();

    // Filenames start with YYYY-MM-DD_HHMM — descending sort = newest first
    meetings.sort_by(|a, b| b.filename.cmp(&a.filename));
    meetings
}

#[tauri::command]
fn read_meeting(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
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
    let rec_dir = expand_path("~/Documents/MeetingTranscriber");
    let (rec, handles) =
        Recorder::start(&mic_hint, &sys_hint, &rec_dir).map_err(|e| e.to_string())?;
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
    rec.stop().map_err(|e| format!("stop: {e}"))?;

    let model_path = expand_path(&model_path);
    let vault_dir = expand_path(&vault_dir);

    eprintln!("model_path={model_path}");
    eprintln!("vault_dir={vault_dir}");
    eprintln!("mic_wav={}", handles.mic_path);
    eprintln!("sys_wav={}", handles.sys_path);

    let me = whisper::transcribe(&handles.mic_path, &model_path, "Я", "auto")
        .map_err(|e| format!("transcribe mic: {e}"))?;
    let them = whisper::transcribe(&handles.sys_path, &model_path, "Собеседники", "auto")
        .map_err(|e| format!("transcribe sys: {e}"))?;
    let segments = whisper::merge(me, them);

    let saved_path = export::save_to_vault(&vault_dir, &segments, duration_min)
        .map_err(|e| format!("save vault: {e}"))?;

    Ok(TranscriptResult { segments, saved_path })
}

#[tauri::command]
async fn generate_summary(transcript: String) -> Result<summary::SummaryResult, String> {
    summary::generate_summary(&transcript)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_summary_in_vault(path: String, summary: String, title: String) -> Result<(), String> {
    export::update_with_summary(&path, &summary, &title).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState { recorder: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            list_devices,
            list_meetings,
            read_meeting,
            start_recording,
            pause_recording,
            resume_recording,
            stop_and_transcribe,
            generate_summary,
            update_summary_in_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
