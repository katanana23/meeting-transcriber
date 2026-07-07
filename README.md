# Meeting Transcriber

Локальное macOS-приложение для записи и транскрипции встреч. Пишет два канала — твой микрофон (AirPods) и системный звук (голоса коллег из Zoom/Meet) — и превращает их в размеченный транскрипт `[Я]` / `[Собеседники]` с сохранением в Obsidian.

**Всё локально. Ничего не уходит в облако.**

## Требования

- macOS 13+ (Apple Silicon)
- [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`)
- Rust (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- whisper.cpp: `brew install whisper-cpp`
- BlackHole 2ch: `brew install blackhole-2ch`

## Настройка BlackHole (один раз, вручную)

Это единственный неавтоматизируемый шаг. BlackHole — виртуальное аудиоустройство, через которое перехватывается системный звук.

1. Открой **Audio MIDI Setup** (Настройка Audio-MIDI)
2. Внизу слева `+` → **Create Multi-Output Device**
3. В нём отметь галочками: **свои AirPods** (чтобы слышать) и **BlackHole 2ch** (чтобы записывать)
4. В System Settings → Sound → **Output** выбери созданный Multi-Output Device
5. Микрофон оставь AirPods как обычно

Теперь весь системный звук (голоса коллег в Zoom) параллельно идёт и тебе в уши, и в BlackHole, откуда его читает приложение.

## Модель Whisper

```bash
mkdir -p models
curl -L -o models/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
```

Если на твоём железе транскрипция медленная — возьми `ggml-medium.bin` (меньше и быстрее, чуть менее точная).

## Запуск

```bash
bun install
bun tauri dev
```

Сборка `.dmg`:

```bash
bun tauri build
```

## Как пользоваться

1. Проверь в настройках (⚙️): подстроки имён устройств (`AirPods`, `BlackHole`), путь к Obsidian vault, путь к модели
2. Начни встречу в Zoom/Meet
3. Нажми **Начать запись**
4. После встречи — **Стоп и транскрипция**
5. Транскрипт появится на экране и сохранится как `.md` в vault с тегом `#meeting-transcript`

## Статус проекта / известные ограничения

- **MVP**: транскрипция после остановки записи, не realtime. Realtime chunking — фаза 2.
- Разделение спикеров — по каналам (mic vs system). Внутри "Собеседников" отдельные голоса не различаются (для этого нужна diarization через pyannote — фаза 3).
- Файлы `audio.rs` требуют локальной проверки: имена устройств и форматы сэмплов зависят от конкретной конфигурации. При первом запуске смотри список устройств в настройках.

## Архитектура

```
AirPods (mic) ──┐
                 ├──> Rust (cpal) ──> два WAV ──> whisper-cli (Metal) ──> merge ──> UI + Obsidian .md
BlackHole (sys) ─┘
```

Stack: Tauri 2 + React + TypeScript + Tailwind (shadcn-style) + whisper.cpp + cpal.
