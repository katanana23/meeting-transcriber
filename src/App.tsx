import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mic, Square, Pause, Play, Settings, FolderOpen, Loader2 } from "lucide-react";

interface Segment {
  start_ms: number;
  end_ms: number;
  speaker: string;
  text: string;
}

interface TranscriptResult {
  segments: Segment[];
  saved_path: string;
}

type Status = "idle" | "recording" | "paused" | "transcribing" | "done";

const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [savedPath, setSavedPath] = useState("");
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  // Настройки — в MVP хранятся в localStorage
  const [micHint, setMicHint] = useState(localStorage.getItem("micHint") || "AirPods");
  const [sysHint, setSysHint] = useState(localStorage.getItem("sysHint") || "BlackHole");
  const [vaultDir, setVaultDir] = useState(
    localStorage.getItem("vaultDir") || "/Users/aidyn/Obsidian/00 Inbox"
  );
  const [modelPath, setModelPath] = useState(
    localStorage.getItem("modelPath") || "models/ggml-large-v3-turbo.bin"
  );

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    invoke<string[]>("list_devices").then(setDevices).catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem("micHint", micHint);
    localStorage.setItem("sysHint", sysHint);
    localStorage.setItem("vaultDir", vaultDir);
    localStorage.setItem("modelPath", modelPath);
  }, [micHint, sysHint, vaultDir, modelPath]);

  const start = async () => {
    setError("");
    setSegments([]);
    setSavedPath("");
    try {
      await invoke("start_recording", { micHint, sysHint });
      setStatus("recording");
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (e) {
      setError(String(e));
    }
  };

  const pause = async () => {
    await invoke("pause_recording");
    setStatus("paused");
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const resume = async () => {
    await invoke("resume_recording");
    setStatus("recording");
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  };

  const stop = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setStatus("transcribing");
    try {
      const result = await invoke<TranscriptResult>("stop_and_transcribe", {
        modelPath,
        vaultDir,
        durationMin: Math.max(1, Math.round(elapsed / 60)),
      });
      setSegments(result.segments);
      setSavedPath(result.saved_path);
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("idle");
    }
  };

  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Meeting Transcriber</h1>
        <div className="flex items-center gap-2">
          {status === "recording" && (
            <Badge className="bg-red-500/20 text-red-400">● REC {fmtTime(elapsed * 1000)}</Badge>
          )}
          {status === "paused" && (
            <Badge className="bg-yellow-500/20 text-yellow-400">⏸ Пауза</Badge>
          )}
          <Button variant="ghost" size="icon" onClick={() => setShowSettings(!showSettings)}>
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Settings */}
      {showSettings && (
        <Card className="space-y-3 text-sm">
          <label className="block">
            Микрофон (подстрока имени)
            <input
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={micHint}
              onChange={(e) => setMicHint(e.target.value)}
            />
          </label>
          <label className="block">
            Системный звук (подстрока имени)
            <input
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={sysHint}
              onChange={(e) => setSysHint(e.target.value)}
            />
          </label>
          <label className="block">
            Папка Obsidian vault
            <input
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={vaultDir}
              onChange={(e) => setVaultDir(e.target.value)}
            />
          </label>
          <label className="block">
            Путь к модели Whisper
            <input
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={modelPath}
              onChange={(e) => setModelPath(e.target.value)}
            />
          </label>
          {devices.length > 0 && (
            <div className="text-muted">
              Доступные устройства: {devices.join(", ")}
            </div>
          )}
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="border-red-500/40 bg-red-500/10 text-sm text-red-300">{error}</Card>
      )}

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-card p-4">
        {status === "transcribing" && (
          <div className="flex h-full items-center justify-center gap-3 text-muted">
            <Loader2 className="h-5 w-5 animate-spin" /> Транскрибирую… это может занять пару минут
          </div>
        )}
        {segments.length === 0 && status !== "transcribing" && (
          <div className="flex h-full items-center justify-center text-muted">
            {status === "recording"
              ? "Идёт запись. Транскрипт появится после остановки."
              : "Нажми запись, чтобы начать."}
          </div>
        )}
        <div className="space-y-3">
          {segments.map((s, i) => (
            <div key={i} className="flex gap-3">
              <span className="mt-0.5 shrink-0 font-mono text-xs text-muted">
                {fmtTime(s.start_ms)}
              </span>
              <div>
                <Badge
                  className={
                    s.speaker === "Я" ? "bg-me/20 text-me" : "bg-them/20 text-them"
                  }
                >
                  {s.speaker}
                </Badge>
                <p className="mt-1 text-sm leading-relaxed">{s.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Saved notice */}
      {savedPath && (
        <Card className="flex items-center justify-between text-sm">
          <span className="text-muted">Сохранено: {savedPath}</span>
          <FolderOpen className="h-4 w-4 text-muted" />
        </Card>
      )}

      {/* Controls */}
      <div className="flex justify-center gap-3">
        {(status === "idle" || status === "done") && (
          <Button size="lg" onClick={start}>
            <Mic className="h-5 w-5" /> Начать запись
          </Button>
        )}
        {status === "recording" && (
          <>
            <Button size="lg" variant="outline" onClick={pause}>
              <Pause className="h-5 w-5" /> Пауза
            </Button>
            <Button size="lg" variant="destructive" onClick={stop}>
              <Square className="h-5 w-5" /> Стоп и транскрипция
            </Button>
          </>
        )}
        {status === "paused" && (
          <>
            <Button size="lg" onClick={resume}>
              <Play className="h-5 w-5" /> Продолжить
            </Button>
            <Button size="lg" variant="destructive" onClick={stop}>
              <Square className="h-5 w-5" /> Стоп и транскрипция
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
