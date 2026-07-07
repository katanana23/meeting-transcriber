// export.rs — сохранение транскрипта в Obsidian-совместимый Markdown.

use crate::whisper::Segment;
use anyhow::Result;
use chrono::Local;

fn fmt_ts(ms: u64) -> String {
    let s = ms / 1000;
    format!("{:02}:{:02}:{:02}", s / 3600, (s % 3600) / 60, s % 60)
}

pub fn to_markdown(segments: &[Segment], duration_min: u64) -> String {
    let date = Local::now().format("%Y-%m-%d");
    let mut md = format!(
        "---\ntags: [meeting-transcript]\ndate: {date}\nduration: {duration_min}m\n---\n\n# Встреча {date}\n\n"
    );
    for seg in segments {
        md.push_str(&format!(
            "**[{}] {}:** {}\n\n",
            fmt_ts(seg.start_ms),
            seg.speaker,
            seg.text
        ));
    }
    md
}

pub fn save_to_vault(vault_dir: &str, segments: &[Segment], duration_min: u64) -> Result<String> {
    std::fs::create_dir_all(vault_dir)?;
    let filename = format!(
        "{}/{}_meeting.md",
        vault_dir,
        Local::now().format("%Y-%m-%d_%H%M")
    );
    std::fs::write(&filename, to_markdown(segments, duration_min))?;
    Ok(filename)
}
