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
        "---\ntags: [meeting-transcript]\ndate: {date}\nduration: {duration_min}m\n---\n\n# Встреча {date}\n\n## Транскрипт\n\n"
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

/// Обновляет или добавляет поле в frontmatter YAML.
fn set_frontmatter_field(content: &str, field: &str, value: &str) -> String {
    if !content.starts_with("---\n") {
        return content.to_string();
    }
    let Some(fm_end) = content[4..].find("\n---") else {
        return content.to_string();
    };
    let fm = &content[4..4 + fm_end];
    let prefix = format!("{field}: ");
    let new_fm = if fm.lines().any(|l| l.starts_with(&prefix)) {
        fm.lines()
            .map(|l| if l.starts_with(&prefix) { format!("{field}: {value}") } else { l.to_string() })
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        format!("{fm}\n{field}: {value}")
    };
    // +4 for "\n---", then skip past "\n---\n" = +5 more chars... let's just rebuild
    let after_fm = &content[4 + fm_end + 4..]; // skip "\n---\n"
    format!("---\n{new_fm}\n---\n{after_fm}")
}

/// Вставляет/заменяет Summary в файле и обновляет title в frontmatter.
pub fn update_with_summary(path: &str, summary: &str, title: &str) -> Result<()> {
    let content = std::fs::read_to_string(path)?;

    // Update title in frontmatter
    let content = if !title.is_empty() {
        set_frontmatter_field(&content, "title", title)
    } else {
        content
    };

    let summary_block = format!("## Summary\n\n{summary}\n\n---\n\n");

    let updated = if content.contains("## Summary\n") {
        if let (Some(start), Some(rel_end)) = (
            content.find("## Summary\n"),
            content
                .find("## Summary\n")
                .and_then(|s| content[s..].find("## Транскрипт\n").map(|e| (s, e)))
                .map(|(_s, e)| e),
        ) {
            let end = content.find("## Summary\n").unwrap() + rel_end;
            format!("{}{}{}", &content[..start], summary_block, &content[end..])
        } else {
            content.replacen("## Summary\n", &format!("{summary_block}## Транскрипт\n"), 1)
        }
    } else if let Some(pos) = content.find("## Транскрипт\n") {
        format!("{}{}{}", &content[..pos], summary_block, &content[pos..])
    } else {
        format!("{content}\n\n{summary_block}")
    };

    std::fs::write(path, updated)?;
    Ok(())
}
