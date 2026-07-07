use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Serialize, Deserialize)]
pub struct SummaryResult {
    pub title: String,
    pub summary: String,
}

pub async fn generate_summary(transcript: &str) -> Result<SummaryResult> {
    let _ = dotenvy::from_path(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".env"),
    );
    let _ = dotenvy::dotenv();

    let api_key = std::env::var("ANTHROPIC_API_KEY").unwrap_or_default();
    if api_key.is_empty() || api_key == "your_key_here" {
        return Err(anyhow!(
            "ANTHROPIC_API_KEY не задан. Создайте файл src-tauri/.env с ключом (см. .env.example)."
        ));
    }

    let prompt = format!(
        "Analyze this meeting transcript. Respond in the same language as the transcript.\n\
        The very first line must be exactly: TITLE: <meeting title in 3-6 words>\n\
        Then on the next lines provide:\n\n\
        ## Краткое резюме\n\
        [3-5 sentences]\n\n\
        ## Ключевые моменты\n\
        - [решение / вопрос / задача] — [Спикер]\n\n\
        Transcript:\n{transcript}"
    );

    let client = reqwest::Client::new();
    let body = json!({
        "model": "claude-sonnet-4-6",
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": prompt}]
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() || e.is_timeout() {
                anyhow!("Нет интернета или сервер недоступен: {e}")
            } else {
                anyhow!("Ошибка сети: {e}")
            }
        })?;

    let status = resp.status();
    let json: Value = resp
        .json()
        .await
        .map_err(|e| anyhow!("Ошибка чтения ответа: {e}"))?;

    if !status.is_success() {
        let msg = json["error"]["message"].as_str().unwrap_or("неизвестная ошибка");
        return Err(match status.as_u16() {
            401 => anyhow!("Невалидный API-ключ. Проверьте ANTHROPIC_API_KEY в src-tauri/.env"),
            429 => anyhow!("Rate limit. Подождите минуту и попробуйте снова."),
            _ => anyhow!("API error {status}: {msg}"),
        });
    }

    let text = json["content"][0]["text"]
        .as_str()
        .ok_or_else(|| anyhow!("Неожиданный формат ответа API"))?;

    Ok(parse_response(text))
}

fn parse_response(text: &str) -> SummaryResult {
    let first_line = text.lines().next().unwrap_or("");
    let title = first_line
        .strip_prefix("TITLE: ")
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "Встреча".to_string());

    let summary = text
        .lines()
        .skip(1)
        .skip_while(|l| l.trim().is_empty())
        .collect::<Vec<&str>>()
        .join("\n");

    SummaryResult { title, summary }
}
