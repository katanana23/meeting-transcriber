use anyhow::{anyhow, Result};
use serde_json::{json, Value};

pub async fn generate_summary(transcript: &str) -> Result<String> {
    // Load .env from src-tauri/ at compile-time path (dev) then fallback to CWD
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
        "Analyze this meeting transcript and respond in the same language as the transcript.\n\
        Provide:\n\
        1. A concise summary (3-5 sentences)\n\
        2. Key points: decisions made, open questions, action items — each with the speaker who mentioned it\n\n\
        Use exactly this format:\n\
        ## Краткое резюме\n\
        [3-5 предложений]\n\n\
        ## Ключевые моменты\n\
        - [решение / вопрос / задача] — [Спикер]\n\n\
        Транскрипт:\n{transcript}"
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
        let msg = json["error"]["message"]
            .as_str()
            .unwrap_or("неизвестная ошибка");
        return Err(match status.as_u16() {
            401 => anyhow!("Невалидный API-ключ. Проверьте ANTHROPIC_API_KEY в src-tauri/.env"),
            429 => anyhow!("Rate limit. Подождите минуту и попробуйте снова."),
            _ => anyhow!("API error {status}: {msg}"),
        });
    }

    let text = json["content"][0]["text"]
        .as_str()
        .ok_or_else(|| anyhow!("Неожиданный формат ответа API"))?
        .to_string();

    Ok(text)
}
