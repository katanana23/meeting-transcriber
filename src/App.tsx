import { useEffect, useRef, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Mic, Square, Pause, Play, Settings, Loader2,
  ChevronDown, ChevronUp, Sparkles, ArrowLeft, Plus, Clock, FileText,
  Copy, Check,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type AppView     = "home" | "detail" | "recording";
type RecStatus   = "idle" | "recording" | "paused" | "transcribing" | "done";
type SummaryStatus = "idle" | "loading" | "done" | "error";

interface Segment { start_ms: number; end_ms: number; speaker: string; text: string; }
interface TranscriptResult { segments: Segment[]; saved_path: string; }
interface MeetingMeta { path: string; filename: string; date: string; duration_min: number; preview: string; }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function parseMdSegments(content: string): { summary: string; segments: Segment[] } {
  let summary = "";
  const m = content.match(/## Summary\n\n([\s\S]*?)(?:\n\n---|\n\n##)/);
  if (m) summary = m[1].trim();
  const segments: Segment[] = [];
  const re = /\*\*\[(\d{2}:\d{2}:\d{2})\] ([^:*]+):\*\* ([\s\S]*?)(?=\n\n\*\*\[|$)/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(content)) !== null) {
    const [, time, speaker, text] = hit;
    const [h, min, s] = time.split(":").map(Number);
    segments.push({ start_ms: (h * 3600 + min * 60 + s) * 1000, end_ms: 0, speaker: speaker.trim(), text: text.trim() });
  }
  return { summary, segments };
}

const segmentsToText = (segs: Segment[]) =>
  segs.map((s) => `[${s.speaker}] ${fmtTime(s.start_ms)}\n${s.text}`).join("\n\n");

function CopyBtn({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      onClick={copy}
      className={cn(
        "flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium",
        "border border-white/[0.08] transition-all duration-100",
        copied
          ? "bg-[#28c96a]/15 border-[#28c96a]/30 text-[#28c96a]"
          : "bg-white/[0.04] text-muted hover:bg-white/[0.08] hover:text-foreground",
        className
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Скопировано" : "Копировать"}
    </button>
  );
}

// ─── Bento button ─────────────────────────────────────────────────────────────

function BentoBtn({
  icon: Icon, label, sublabel, onClick, disabled, className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; sublabel?: string;
  onClick?: () => void; disabled?: boolean; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl py-5",
        "border border-white/[0.07] transition-all duration-100",
        "shadow-[0_4px_28px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.07)]",
        "active:scale-[0.96] disabled:opacity-30 disabled:cursor-not-allowed",
        className
      )}
    >
      <Icon className="h-6 w-6" />
      <span className="text-sm font-semibold leading-none">{label}</span>
      {sublabel && <span className="text-[10px] opacity-50">{sublabel}</span>}
    </button>
  );
}

// ─── Device select ────────────────────────────────────────────────────────────

function DeviceSelect({ label, value, onChange, devices, loading }: {
  label: string; value: string; onChange: (v: string) => void;
  devices: string[]; loading: boolean;
}) {
  const matched = devices.find((d) => d.toLowerCase().includes(value.toLowerCase()));
  const isAvailable = Boolean(matched);
  const selectValue = matched ?? value;
  return (
    <label className="block text-xs text-muted mb-0.5">
      {label}
      {loading ? (
        <div className="mt-1 flex items-center gap-2 text-muted">
          <Loader2 className="h-3 w-3 animate-spin" /> Загружаю…
        </div>
      ) : (
        <>
          <select
            className="mt-1 w-full rounded-lg border border-white/[0.08] bg-[#1e1e25] px-3 py-2 text-sm text-foreground"
            value={selectValue}
            onChange={(e) => onChange(e.target.value)}
          >
            {!isAvailable && value && <option value={value}>⚠ {value} — недоступен</option>}
            {devices.map((d) => <option key={d} value={d}>{d}</option>)}
            {devices.length === 0 && <option value="" disabled>Устройства не найдены</option>}
          </select>
          {!isAvailable && value && (
            <p className="mt-1 text-xs text-yellow-400">⚠ «{value}» недоступен — выбери другое</p>
          )}
        </>
      )}
    </label>
  );
}

// ─── Settings panel ───────────────────────────────────────────────────────────

function SettingsPanel({ micHint, setMicHint, sysHint, setSysHint, vaultDir, setVaultDir, modelPath, setModelPath, devices, devicesLoading }: {
  micHint: string; setMicHint: (v: string) => void;
  sysHint: string; setSysHint: (v: string) => void;
  vaultDir: string; setVaultDir: (v: string) => void;
  modelPath: string; setModelPath: (v: string) => void;
  devices: string[]; devicesLoading: boolean;
}) {
  const inputCls = "mt-1 w-full rounded-lg border border-white/[0.08] bg-[#1e1e25] px-3 py-2 text-sm text-foreground";
  return (
    <Card className="space-y-3 text-xs text-muted">
      <DeviceSelect label="Микрофон" value={micHint} onChange={setMicHint} devices={devices} loading={devicesLoading} />
      <DeviceSelect label="Системный звук (BlackHole)" value={sysHint} onChange={setSysHint} devices={devices} loading={devicesLoading} />
      <label className="block">Папка Obsidian vault<input className={inputCls} value={vaultDir} onChange={(e) => setVaultDir(e.target.value)} /></label>
      <label className="block">Путь к модели Whisper<input className={inputCls} value={modelPath} onChange={(e) => setModelPath(e.target.value)} /></label>
    </Card>
  );
}

// ─── Transcript view ──────────────────────────────────────────────────────────

function TranscriptView({ segments }: { segments: Segment[] }) {
  if (!segments.length) return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
      <FileText className="h-10 w-10 opacity-20" />
      <span className="text-sm">Транскрипт пуст</span>
    </div>
  );
  return (
    <div className="space-y-4">
      {segments.map((s, i) => (
        <div key={i} className="flex gap-3">
          <span className="mt-0.5 shrink-0 font-mono text-[11px] text-muted tabular-nums">{fmtTime(s.start_ms)}</span>
          <div>
            <span className={cn(
              "inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold",
              s.speaker === "Я"
                ? "bg-[#28c96a]/15 text-[#28c96a]"
                : "bg-[#7c7af5]/15 text-[#7c7af5]"
            )}>
              {s.speaker}
            </span>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground/85">{s.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [micHint,   setMicHint]   = useState(localStorage.getItem("micHint")   || "AirPods");
  const [sysHint,   setSysHint]   = useState(localStorage.getItem("sysHint")   || "BlackHole");
  const [vaultDir,  setVaultDir]  = useState(localStorage.getItem("vaultDir")  || "~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Dracula/00 Inbox");
  const [modelPath, setModelPath] = useState(localStorage.getItem("modelPath") || "~/Downloads/meeting-transcriber/models/ggml-large-v3-turbo.bin");
  useEffect(() => {
    localStorage.setItem("micHint", micHint);
    localStorage.setItem("sysHint", sysHint);
    localStorage.setItem("vaultDir", vaultDir);
    localStorage.setItem("modelPath", modelPath);
  }, [micHint, sysHint, vaultDir, modelPath]);

  const [view,           setView]           = useState<AppView>("home");
  const [showSettings,   setShowSettings]   = useState(false);
  const [devices,        setDevices]        = useState<string[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);

  const refreshDevices = () => {
    setDevicesLoading(true);
    invoke<string[]>("list_devices").then(setDevices).catch(() => setDevices([])).finally(() => setDevicesLoading(false));
  };
  const toggleSettings = () => { if (!showSettings) refreshDevices(); setShowSettings((s) => !s); };

  // Home
  const [meetings,       setMeetings]       = useState<MeetingMeta[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const loadMeetings = async () => {
    setMeetingsLoading(true);
    try { setMeetings(await invoke<MeetingMeta[]>("list_meetings", { vaultDir })); }
    catch { setMeetings([]); }
    finally { setMeetingsLoading(false); }
  };
  useEffect(() => { if (view === "home") loadMeetings(); }, [view, vaultDir]);

  // Detail
  const [detailMeta,          setDetailMeta]          = useState<MeetingMeta | null>(null);
  const [detailContent,       setDetailContent]       = useState("");
  const [detailLoading,       setDetailLoading]       = useState(false);
  const [detailSummaryStatus, setDetailSummaryStatus] = useState<SummaryStatus>("idle");
  const [detailSummaryError,  setDetailSummaryError]  = useState("");
  const detailParsed = useMemo(() => parseMdSegments(detailContent), [detailContent]);

  const openMeeting = async (meta: MeetingMeta) => {
    setDetailMeta(meta); setDetailContent(""); setDetailLoading(true);
    setDetailSummaryStatus("idle"); setDetailSummaryError(""); setView("detail");
    try { setDetailContent(await invoke<string>("read_meeting", { path: meta.path })); }
    finally { setDetailLoading(false); }
  };

  const doGenerateSummaryForDetail = async () => {
    if (!detailParsed.segments.length || !detailMeta) return;
    setDetailSummaryStatus("loading"); setDetailSummaryError("");
    const txt = detailParsed.segments.map((s) => `[${s.speaker}] (${fmtTime(s.start_ms)}): ${s.text}`).join("\n");
    try {
      const result = await invoke<string>("generate_summary", { transcript: txt });
      await invoke("update_summary_in_vault", { path: detailMeta.path, summary: result });
      setDetailContent(await invoke<string>("read_meeting", { path: detailMeta.path }));
      setDetailSummaryStatus("done");
    } catch (e) { setDetailSummaryError(String(e)); setDetailSummaryStatus("error"); }
  };

  // Recording
  const [recStatus,      setRecStatus]      = useState<RecStatus>("idle");
  const [elapsed,        setElapsed]        = useState(0);
  const [segments,       setSegments]       = useState<Segment[]>([]);
  const [savedPath,      setSavedPath]      = useState("");
  const [recError,       setRecError]       = useState("");
  const [summary,        setSummary]        = useState("");
  const [summaryStatus,  setSummaryStatus]  = useState<SummaryStatus>("idle");
  const [summaryError,   setSummaryError]   = useState("");
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRec = async () => {
    setRecError(""); setSegments([]); setSavedPath(""); setSummary(""); setSummaryStatus("idle"); setSummaryError("");
    try {
      await invoke("start_recording", { micHint, sysHint });
      setRecStatus("recording"); setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (e) { setRecError(String(e)); }
  };
  const pauseRec = async () => { await invoke("pause_recording"); setRecStatus("paused"); if (timerRef.current) clearInterval(timerRef.current); };
  const resumeRec = async () => { await invoke("resume_recording"); setRecStatus("recording"); timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000); };
  const stopRec = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setRecStatus("transcribing");
    try {
      const r = await invoke<TranscriptResult>("stop_and_transcribe", { modelPath, vaultDir, durationMin: Math.max(1, Math.round(elapsed / 60)) });
      setSegments(r.segments); setSavedPath(r.saved_path); setRecStatus("done");
    } catch (e) { setRecError(String(e)); setRecStatus("idle"); }
  };
  const doGenerateSummary = async () => {
    if (!segments.length) return;
    setSummaryStatus("loading"); setSummaryError(""); setSummaryCollapsed(false);
    const txt = segments.map((s) => `[${s.speaker}] (${fmtTime(s.start_ms)}): ${s.text}`).join("\n");
    try {
      const result = await invoke<string>("generate_summary", { transcript: txt });
      setSummary(result); setSummaryStatus("done");
      if (savedPath) await invoke("update_summary_in_vault", { path: savedPath, summary: result });
    } catch (e) { setSummaryError(String(e)); setSummaryStatus("error"); }
  };

  const goHome = () => { setView("home"); setShowSettings(false); };

  // ── Shared header ──
  const Header = ({ left }: { left?: React.ReactNode }) => (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-1.5">
        {left}
        <h1 className="text-[15px] font-semibold tracking-tight">Aid AI Meeting Assistant</h1>
      </div>
      <Button variant="ghost" size="icon" onClick={toggleSettings}>
        <Settings className="h-4 w-4" />
      </Button>
    </div>
  );

  // ══════════════════════════════════════
  // HOME
  // ══════════════════════════════════════
  if (view === "home") return (
    <div className="flex h-screen flex-col gap-3 p-5">
      <Header />
      {showSettings && <SettingsPanel {...{ micHint, setMicHint, sysHint, setSysHint, vaultDir, setVaultDir, modelPath, setModelPath, devices, devicesLoading }} />}

      {/* Featured new-recording button */}
      <button
        onClick={() => { setRecStatus("idle"); setView("recording"); }}
        className={cn(
          "flex items-center gap-4 rounded-2xl p-5 text-left w-full",
          "bg-gradient-to-br from-[#1a6ef5] to-[#0040c8]",
          "border border-blue-500/20",
          "shadow-[0_4px_32px_rgba(26,110,245,0.35)]",
          "transition-all duration-150 hover:shadow-[0_4px_40px_rgba(26,110,245,0.5)] active:scale-[0.99]"
        )}
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15">
          <Mic className="h-6 w-6 text-white" />
        </div>
        <div>
          <div className="text-base font-bold text-white">Новая запись</div>
          <div className="text-xs text-white/55">Запустить транскрипцию встречи</div>
        </div>
        <Plus className="ml-auto h-5 w-5 text-white/40" />
      </button>

      {/* List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
        {meetingsLoading && (
          <div className="flex items-center justify-center gap-2 py-12 text-muted text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Загружаю…
          </div>
        )}
        {!meetingsLoading && meetings.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted">
            <FileText className="h-10 w-10 opacity-20" />
            <span className="text-sm">Встреч пока нет</span>
          </div>
        )}
        {meetings.map((m) => (
          <button
            key={m.path}
            onClick={() => openMeeting(m)}
            className={cn(
              "w-full text-left rounded-xl border border-white/[0.07] bg-card px-4 py-3.5",
              "shadow-[0_2px_16px_rgba(0,0,0,0.4)]",
              "hover:border-white/[0.12] hover:bg-card-2 transition-all duration-100 active:scale-[0.99]"
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-sm">{m.date || m.filename.slice(0, 10)}</span>
              {m.duration_min > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-muted">
                  <Clock className="h-3 w-3" />{m.duration_min} мин
                </span>
              )}
            </div>
            {m.preview && <p className="text-xs text-muted leading-relaxed line-clamp-2">{m.preview}</p>}
          </button>
        ))}
      </div>
    </div>
  );

  // ══════════════════════════════════════
  // DETAIL
  // ══════════════════════════════════════
  if (view === "detail") return (
    <div className="flex h-screen flex-col gap-3 p-5">
      <Header left={
        <Button variant="ghost" size="icon" onClick={goHome}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
      } />
      {showSettings && <SettingsPanel {...{ micHint, setMicHint, sysHint, setSysHint, vaultDir, setVaultDir, modelPath, setModelPath, devices, devicesLoading }} />}

      {detailMeta && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{detailMeta.date || detailMeta.filename.slice(0, 10)}</span>
          {detailMeta.duration_min > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted"><Clock className="h-3 w-3" />{detailMeta.duration_min} мин</span>
          )}
          <span className="rounded-md border border-white/[0.07] px-2 py-0.5 text-[10px] text-muted">read-only</span>
        </div>
      )}

      {detailLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-muted text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаю…
        </div>
      ) : (
        <>
          {detailParsed.summary && (
            <Card className="text-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">Summary</p>
                <CopyBtn text={detailParsed.summary} />
              </div>
              <div className="whitespace-pre-wrap leading-relaxed text-foreground/80 text-sm">{detailParsed.summary}</div>
            </Card>
          )}

          {detailSummaryStatus === "loading" && (
            <Card className="flex items-center gap-3 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" /> Генерирую summary…
            </Card>
          )}
          {detailSummaryStatus === "error" && (
            <Card className="border-red-500/30 bg-red-500/10 text-sm text-red-400">{detailSummaryError}</Card>
          )}

          <div className="flex-1 overflow-y-auto rounded-xl border border-white/[0.07] bg-card p-4 shadow-[0_2px_24px_rgba(0,0,0,0.5)]">
            {detailParsed.segments.length > 0 && (
              <div className="flex justify-end mb-3">
                <CopyBtn text={segmentsToText(detailParsed.segments)} />
              </div>
            )}
            <TranscriptView segments={detailParsed.segments} />
          </div>

          {detailParsed.segments.length > 0 && detailSummaryStatus !== "loading" && (
            <BentoBtn
              icon={Sparkles}
              label={detailParsed.summary ? "Обновить Summary" : "Сделать Summary"}
              sublabel={!detailParsed.summary ? "☁ требует интернет" : undefined}
              onClick={doGenerateSummaryForDetail}
              className="bg-gradient-to-b from-[#5c59e8] to-[#3d3aad] text-white"
            />
          )}
        </>
      )}
    </div>
  );

  // ══════════════════════════════════════
  // RECORDING
  // ══════════════════════════════════════
  return (
    <div className="flex h-screen flex-col gap-3 p-5">
      <Header left={
        (recStatus === "idle" || recStatus === "done") ? (
          <Button variant="ghost" size="icon" onClick={goHome}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        ) : undefined
      } />
      {showSettings && <SettingsPanel {...{ micHint, setMicHint, sysHint, setSysHint, vaultDir, setVaultDir, modelPath, setModelPath, devices, devicesLoading }} />}

      {/* Recording status bar */}
      {(recStatus === "recording" || recStatus === "paused") && (
        <div className={cn(
          "flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-semibold",
          recStatus === "recording"
            ? "bg-[#f03a2e]/10 border border-[#f03a2e]/20 text-[#f03a2e]"
            : "bg-yellow-500/10 border border-yellow-500/20 text-yellow-400"
        )}>
          <span className={cn("h-2 w-2 rounded-full", recStatus === "recording" ? "bg-[#f03a2e] animate-pulse-dot" : "bg-yellow-400")} />
          {recStatus === "recording" ? `REC ${fmtTime(elapsed * 1000)}` : `Пауза ${fmtTime(elapsed * 1000)}`}
        </div>
      )}

      {/* Errors */}
      {recError && <Card className="border-red-500/30 bg-red-500/10 text-sm text-red-400">{recError}</Card>}

      {/* Summary */}
      {summaryStatus === "loading" && (
        <Card className="flex items-center gap-3 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" /> Генерирую summary… 5–15 сек
        </Card>
      )}
      {summaryStatus === "error" && (
        <Card className="border-red-500/30 bg-red-500/10 text-sm text-red-400">{summaryError}</Card>
      )}
      {summaryStatus === "done" && (
        <Card>
          <div className="flex items-center justify-between">
            <button
              className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted"
              onClick={() => setSummaryCollapsed((c) => !c)}
            >
              Summary
              {summaryCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            </button>
            <CopyBtn text={summary} />
          </div>
          {!summaryCollapsed && (
            <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">{summary}</div>
          )}
        </Card>
      )}

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-white/[0.07] bg-card p-4 shadow-[0_2px_24px_rgba(0,0,0,0.5)]">
        {segments.length > 0 && (
          <div className="flex justify-end mb-3">
            <CopyBtn text={segmentsToText(segments)} />
          </div>
        )}
        {recStatus === "transcribing" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">Транскрибирую… пару минут</span>
          </div>
        )}
        {segments.length === 0 && recStatus !== "transcribing" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
            <Mic className="h-10 w-10 opacity-20" />
            <span className="text-sm">
              {recStatus === "recording" ? "Идёт запись…" : "Нажми кнопку ниже чтобы начать"}
            </span>
          </div>
        )}
        <TranscriptView segments={segments} />
      </div>

      {/* Saved path */}
      {savedPath && (
        <p className="text-center text-[11px] text-muted truncate px-2">
          Сохранено в Obsidian ✓
        </p>
      )}

      {/* Bento control buttons */}
      <div className="flex gap-3">
        {recStatus === "idle" && (
          <BentoBtn icon={Mic} label="Начать запись" onClick={startRec}
            className="bg-gradient-to-b from-[#f03a2e] to-[#c0291e] text-white" />
        )}

        {recStatus === "recording" && (
          <>
            <BentoBtn icon={Pause} label="Пауза" onClick={pauseRec}
              className="bg-gradient-to-b from-[#f09a00] to-[#c07800] text-white" />
            <BentoBtn icon={Square} label="Стоп" sublabel="запустить транскрипцию" onClick={stopRec}
              className="bg-gradient-to-b from-[#2a2a32] to-[#1e1e24] text-white" />
          </>
        )}

        {recStatus === "paused" && (
          <>
            <BentoBtn icon={Play} label="Продолжить" onClick={resumeRec}
              className="bg-gradient-to-b from-[#28c96a] to-[#1a9a50] text-white" />
            <BentoBtn icon={Square} label="Стоп" sublabel="запустить транскрипцию" onClick={stopRec}
              className="bg-gradient-to-b from-[#2a2a32] to-[#1e1e24] text-white" />
          </>
        )}

        {recStatus === "transcribing" && (
          <div className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/[0.07] bg-card py-5 text-sm text-muted shadow-bento">
            <Loader2 className="h-4 w-4 animate-spin" /> Транскрибирую…
          </div>
        )}

        {recStatus === "done" && (
          <>
            {summaryStatus !== "done" && (
              <BentoBtn
                icon={Sparkles}
                label="Сделать Summary"
                sublabel="☁ требует интернет"
                onClick={doGenerateSummary}
                disabled={summaryStatus === "loading"}
                className="bg-gradient-to-b from-[#5c59e8] to-[#3d3aad] text-white"
              />
            )}
            {summaryStatus === "done" && (
              <BentoBtn icon={Sparkles} label="Обновить Summary" onClick={doGenerateSummary}
                className="bg-gradient-to-b from-[#5c59e8] to-[#3d3aad] text-white" />
            )}
            <BentoBtn icon={Mic} label="Новая запись" onClick={startRec}
              className="bg-gradient-to-b from-[#f03a2e] to-[#c0291e] text-white" />
          </>
        )}
      </div>
    </div>
  );
}
