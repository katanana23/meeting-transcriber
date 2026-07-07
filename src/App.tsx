import { useEffect, useRef, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Mic, Square, Pause, Play, Settings, Loader2,
  ChevronDown, ChevronUp, ChevronLeft, Sparkles, Plus, Clock, FileText,
  Copy, Check,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type AppView     = "home" | "detail" | "recording";
type RecStatus   = "idle" | "recording" | "paused" | "transcribing" | "done";
type SummaryStatus = "idle" | "loading" | "done" | "error";

interface Segment { start_ms: number; end_ms: number; speaker: string; text: string; }
interface TranscriptResult { segments: Segment[]; saved_path: string; }
interface MeetingMeta { path: string; filename: string; date: string; duration_min: number; preview: string; title: string; }
interface SummaryResult { title: string; summary: string; }

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

const smallBtnCls = cn(
  "flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium",
  "border border-white/[0.08] bg-white/[0.04] text-muted",
  "transition-all duration-100 hover:bg-white/[0.08] hover:text-foreground",
  "disabled:opacity-40 disabled:cursor-not-allowed"
);

function CopyBtn({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button onClick={copy} className={cn(smallBtnCls, copied && "bg-[#28c96a]/15 border-[#28c96a]/30 text-[#28c96a]", className)}>
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Скопировано" : "Копировать"}
    </button>
  );
}

function ActionBtn({ icon: Icon, label, onClick, disabled, loading, sublabel: _s }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; onClick?: () => void; disabled?: boolean; loading?: boolean; sublabel?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled || loading} className={smallBtnCls}>
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
      {label}
    </button>
  );
}

const HADES_TITLES = [
  "Записи встреч",
  "Пейн и Паника\nснова всё сломали",
  "Стикс вышел\nиз берегов снова",
  "Мой план\nбыл так хорош",
  "Зевс испортил\nвсё как обычно",
  "Харон ушёл\nна перерыв опять",
  "Подземный мир\nждёт вас всех",
  "Мегара знает\nАид волнуется",
  "Гидра выросла\nопять без спроса",
  "Горим ярко\nкак моя карьера",
];

function BlurText({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");
  let idx = 0;
  return (
    <span className={className}>
      {lines.map((line, li) => (
        <span key={li} style={{ display: "block" }}>
          {line.split("").map((char) => {
            const i = idx++;
            return (
              <span key={i} style={{
                display: "inline-block",
                whiteSpace: "pre",
                opacity: 0,
                animation: "blurIn 0.8s forwards",
                animationDelay: `${i * 0.05}s`,
              }}>
                {char}
              </span>
            );
          })}
        </span>
      ))}
    </span>
  );
}

// GIF files go in public/gifs/ — drop any Hercules GIF there with these names
const HERCULES_GIFS = [
  "/gifs/hades.gif",
  "/gifs/pain-panic.gif",
  "/gifs/styx.gif",
  "/gifs/meg.gif",
  "/gifs/zeus.gif",
  "/gifs/charon.gif",
  "/gifs/hercules.gif",
  "/gifs/pegasus.gif",
  "/gifs/hydra.gif",
  "/gifs/muses.gif",
];

function HercAvatar({ idx }: { idx: number }) {
  const [failed, setFailed] = useState(false);
  const src = HERCULES_GIFS[idx % HERCULES_GIFS.length];

  useEffect(() => { setFailed(false); }, [idx]);

  return (
    <div style={{
      width: 32, height: 32, borderRadius: 99, overflow: "hidden", flexShrink: 0,
      border: "1.5px solid rgba(120,90,240,0.35)",
      background: "#0e0820",
    }}>
      {failed ? (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
          🔥
        </div>
      ) : (
        <img
          key={src}
          src={src}
          alt=""
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      )}
    </div>
  );
}

function IconBtn({ icon: Icon, onClick, className }: {
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
        "bg-white/[0.06] hover:bg-white/[0.10] transition-all duration-100 active:scale-[0.94]",
        className
      )}
    >
      <Icon className="h-5 w-5 text-muted" />
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

// ─── Round record button ──────────────────────────────────────────────────────

function RecordBtn({ status, onStart, onStop, onPause, onResume, elapsed }: {
  status: "idle" | "recording" | "paused" | "transcribing" | "done";
  onStart: () => void; onStop: () => void;
  onPause: () => void; onResume: () => void;
  elapsed: number;
}) {
  const isActive = status === "recording" || status === "paused";
  return (
    <div className="flex flex-col items-center gap-3">
      {isActive && (
        <div className={cn(
          "text-xs font-semibold font-mono tabular-nums px-3 py-1 rounded-full",
          status === "recording"
            ? "bg-[#f03a2e]/15 text-[#f03a2e]"
            : "bg-yellow-500/15 text-yellow-400"
        )}>
          {status === "recording" ? "● " : "⏸ "}{fmtTime(elapsed * 1000)}
        </div>
      )}
      <div className="flex items-center gap-4">
        {/* Main round button */}
        <button
          onClick={
            status === "idle" || status === "done" ? onStart
            : status === "recording" || status === "paused" ? onStop
            : undefined
          }
          disabled={status === "transcribing"}
          className={cn(
            "flex h-20 w-20 items-center justify-center rounded-full transition-all duration-150",
            "border-2 active:scale-[0.94] disabled:opacity-40",
            status === "recording"
              ? "bg-[#f03a2e] border-[#f03a2e]/40 shadow-[0_0_24px_rgba(240,58,46,0.4)]"
              : status === "paused"
              ? "bg-yellow-500 border-yellow-500/40 shadow-[0_0_24px_rgba(245,158,11,0.3)]"
              : "bg-[#f03a2e] border-[#f03a2e]/30"
          )}
        >
          {status === "transcribing"
            ? <Loader2 className="h-7 w-7 text-white animate-spin" />
            : status === "recording" || status === "paused"
            ? <Square className="h-7 w-7 text-white fill-white" />
            : <Mic className="h-7 w-7 text-white" />
          }
        </button>

        {/* Pause/resume side button — only when active */}
        {status === "recording" && (
          <button
            onClick={onPause}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.07] border border-white/[0.1] text-muted hover:text-foreground transition-all active:scale-[0.94]"
          >
            <Pause className="h-5 w-5" />
          </button>
        )}
        {status === "paused" && (
          <button
            onClick={onResume}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.07] border border-white/[0.1] text-muted hover:text-foreground transition-all active:scale-[0.94]"
          >
            <Play className="h-5 w-5" />
          </button>
        )}
      </div>
      <span className="text-[11px] text-muted">
        {status === "idle" && "Нажми чтобы начать"}
        {status === "recording" && "Нажми чтобы остановить"}
        {status === "paused" && "Нажми чтобы остановить"}
        {status === "transcribing" && "Транскрибирую…"}
        {status === "done" && "Новая запись"}
      </span>
    </div>
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

function SettingsPanel({ micHint, setMicHint, sysHint, setSysHint, vaultDir, setVaultDir, modelPath, setModelPath, devices, devicesLoading, onClose }: {
  micHint: string; setMicHint: (v: string) => void;
  sysHint: string; setSysHint: (v: string) => void;
  vaultDir: string; setVaultDir: (v: string) => void;
  modelPath: string; setModelPath: (v: string) => void;
  devices: string[]; devicesLoading: boolean;
  onClose: () => void;
}) {
  const inputCls = "mt-1 w-full rounded-lg border border-white/[0.08] bg-[#1e1e25] px-3 py-2 text-sm text-foreground";
  return (
    <Card className="space-y-3 text-xs text-muted">
      <div className="flex items-center gap-3 mb-2">
        <IconBtn icon={ChevronLeft} onClick={onClose} />
        <span className="text-sm font-semibold text-foreground">Настройки</span>
      </div>
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
  const [detailMeta,             setDetailMeta]             = useState<MeetingMeta | null>(null);
  const [detailContent,          setDetailContent]          = useState("");
  const [detailLoading,          setDetailLoading]          = useState(false);
  const [detailSummaryStatus,    setDetailSummaryStatus]    = useState<SummaryStatus>("idle");
  const [detailSummaryError,     setDetailSummaryError]     = useState("");
  const [detailSummaryCollapsed, setDetailSummaryCollapsed] = useState(true);
  const detailParsed = useMemo(() => parseMdSegments(detailContent), [detailContent]);

  const openMeeting = async (meta: MeetingMeta) => {
    setDetailMeta(meta); setDetailContent(""); setDetailLoading(true);
    setDetailSummaryStatus("idle"); setDetailSummaryError("");
    setDetailSummaryCollapsed(true);
    setView("detail");
    try { setDetailContent(await invoke<string>("read_meeting", { path: meta.path })); }
    finally { setDetailLoading(false); }
  };

  const doGenerateSummaryForDetail = async () => {
    if (!detailParsed.segments.length || !detailMeta) return;
    setDetailSummaryStatus("loading"); setDetailSummaryError("");
    const txt = detailParsed.segments.map((s) => `[${s.speaker}] (${fmtTime(s.start_ms)}): ${s.text}`).join("\n");
    try {
      const result = await invoke<SummaryResult>("generate_summary", { transcript: txt });
      await invoke("update_summary_in_vault", { path: detailMeta.path, summary: result.summary, title: result.title });
      setDetailContent(await invoke<string>("read_meeting", { path: detailMeta.path }));
      setDetailSummaryStatus("done");
      setDetailSummaryCollapsed(false);
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
  const [summaryCollapsed, setSummaryCollapsed] = useState(true);
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
    setSummaryStatus("loading"); setSummaryError("");
    const txt = segments.map((s) => `[${s.speaker}] (${fmtTime(s.start_ms)}): ${s.text}`).join("\n");
    try {
      const result = await invoke<SummaryResult>("generate_summary", { transcript: txt });
      setSummary(result.summary); setSummaryStatus("done"); setSummaryCollapsed(false);
      if (savedPath) await invoke("update_summary_in_vault", { path: savedPath, summary: result.summary, title: result.title });
    } catch (e) { setSummaryError(String(e)); setSummaryStatus("error"); }
  };

  const [titleIdx, setTitleIdx] = useState(0);

  useEffect(() => {
    if (view !== "home") return;
    const id = setInterval(() => setTitleIdx((i) => (i + 1) % HADES_TITLES.length), 5000);
    return () => clearInterval(id);
  }, [view]);

  const goHome = () => { setView("home"); setShowSettings(false); setTitleIdx(0); };

  // ── Shared header ──
  const Header = ({ left, titleNode, avatarIdx }: { left?: React.ReactNode; titleNode?: React.ReactNode; avatarIdx?: number }) => (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-3">
        {left}
        {avatarIdx !== undefined && <HercAvatar idx={avatarIdx} />}
        <h1 className="text-[20px] font-bold tracking-tight" style={{ lineHeight: "21px" }}>
          {titleNode ?? <span>Записи встреч</span>}
        </h1>
      </div>
      <IconBtn icon={Settings} onClick={toggleSettings} />
    </div>
  );

  // ══════════════════════════════════════
  // HOME
  // ══════════════════════════════════════
  if (view === "home") return (
    <div className="flex h-screen flex-col p-5 pb-28">
      <Header avatarIdx={titleIdx} titleNode={<BlurText key={titleIdx} text={HADES_TITLES[titleIdx]} />} />
      {showSettings && <SettingsPanel {...{ micHint, setMicHint, sysHint, setSysHint, vaultDir, setVaultDir, modelPath, setModelPath, devices, devicesLoading }} onClose={toggleSettings} />}

      {/* List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-0.5 mt-5">
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
        {meetings.map((m, idx) => (
          <button
            key={m.path}
            onClick={() => openMeeting(m)}
            style={{
              opacity: 0,
              animation: "blurIn 0.5s forwards",
              animationDelay: `${idx * 0.06}s`,
            }}
            className={cn(
              "w-full text-left rounded-xl border border-white/[0.07] bg-card px-4 py-3.5",
              "shadow-[0_2px_16px_rgba(0,0,0,0.4)]",
              "hover:border-white/[0.12] hover:bg-card-2 transition-all duration-100 active:scale-[0.99]"
            )}
          >
            <div className="font-semibold text-sm leading-snug">
              {m.title || m.preview?.slice(0, 40) || "Встреча"}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] text-muted">{m.date || m.filename.slice(0, 10)}</span>
              {m.duration_min > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-muted">
                  <Clock className="h-3 w-3" />{m.duration_min} мин
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Fixed bottom button */}
      <div className="fixed bottom-0 left-0 right-0 flex justify-center pb-6 pt-4 bg-gradient-to-t from-background via-background/95 to-transparent pointer-events-none">
        <button
          onClick={() => { setRecStatus("idle"); setView("recording"); }}
          className="pointer-events-auto flex items-center gap-2.5 rounded-2xl bg-[#1a6ef5] px-6 py-3.5 text-sm font-semibold text-white hover:bg-[#1560d8] active:scale-[0.98] transition-all"
        >
          <Mic className="h-4 w-4" /> Начать запись
        </button>
      </div>
    </div>
  );

  // ══════════════════════════════════════
  // DETAIL
  // ══════════════════════════════════════
  if (view === "detail") return (
    <div className="flex h-screen flex-col p-5 gap-2">
      <Header left={
        <IconBtn icon={ChevronLeft} onClick={goHome} />
      } />
      {showSettings && <SettingsPanel {...{ micHint, setMicHint, sysHint, setSysHint, vaultDir, setVaultDir, modelPath, setModelPath, devices, devicesLoading }} onClose={toggleSettings} />}

      {detailMeta && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-sm font-semibold">{detailMeta.date || detailMeta.filename.slice(0, 10)}</span>
          {detailMeta.duration_min > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted"><Clock className="h-3 w-3" />{detailMeta.duration_min} мин</span>
          )}
        </div>
      )}

      {detailLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-muted text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаю…
        </div>
      ) : (
        <>
          {/* Summary — always-visible collapsible bar */}
          <div className="rounded-xl border border-white/[0.07] bg-card px-4 py-2.5">
            <div className="flex items-center justify-between">
              <button
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted"
                onClick={() => setDetailSummaryCollapsed((c) => !c)}
                disabled={!detailParsed.summary}
              >
                Summary
                {detailParsed.summary && (
                  detailSummaryCollapsed
                    ? <ChevronDown className="h-3.5 w-3.5" />
                    : <ChevronUp className="h-3.5 w-3.5" />
                )}
              </button>
              <div className="flex items-center gap-1.5">
                {detailSummaryStatus === "error" && (
                  <span className="text-[10px] text-red-400">{detailSummaryError}</span>
                )}
                {detailParsed.summary && (
                  <CopyBtn text={detailParsed.summary} />
                )}
                <ActionBtn
                  icon={Sparkles}
                  label={detailParsed.summary ? "Обновить" : "Сделать Summary"}
                  onClick={doGenerateSummaryForDetail}
                  loading={detailSummaryStatus === "loading"}
                  disabled={!detailParsed.segments.length}
                />
              </div>
            </div>
            {detailParsed.summary && !detailSummaryCollapsed && (
              <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80 border-t border-white/[0.06] pt-3">
                {detailParsed.summary}
              </div>
            )}
          </div>

          {/* Transcript — fills all remaining space */}
          <div className="flex-1 overflow-y-auto px-1 py-2">
            {detailParsed.segments.length > 0 && (
              <div className="flex justify-end mb-3">
                <CopyBtn text={segmentsToText(detailParsed.segments)} />
              </div>
            )}
            <TranscriptView segments={detailParsed.segments} />
          </div>
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
          <IconBtn icon={ChevronLeft} onClick={goHome} />
        ) : undefined
      } />
      {showSettings && <SettingsPanel {...{ micHint, setMicHint, sysHint, setSysHint, vaultDir, setVaultDir, modelPath, setModelPath, devices, devicesLoading }} onClose={toggleSettings} />}

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

      {/* Summary — always-visible bar when transcript done */}
      {recStatus === "done" && (
        <div className="rounded-xl border border-white/[0.07] bg-card px-4 py-2.5">
          <div className="flex items-center justify-between">
            <button
              className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted"
              onClick={() => setSummaryCollapsed((c) => !c)}
              disabled={summaryStatus !== "done"}
            >
              Summary
              {summaryStatus === "done" && (
                summaryCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />
              )}
            </button>
            <div className="flex items-center gap-1.5">
              {summaryStatus === "error" && (
                <span className="text-[10px] text-red-400 max-w-[180px] truncate">{summaryError}</span>
              )}
              {summaryStatus === "done" && <CopyBtn text={summary} />}
              <ActionBtn
                icon={Sparkles}
                label={summaryStatus === "done" ? "Обновить" : "Сделать Summary"}
                sublabel="☁"
                onClick={doGenerateSummary}
                loading={summaryStatus === "loading"}
                disabled={!segments.length}
              />
            </div>
          </div>
          {summaryStatus === "done" && !summaryCollapsed && (
            <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80 border-t border-white/[0.06] pt-3">
              {summary}
            </div>
          )}
        </div>
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

      {savedPath && (
        <p className="text-center text-[11px] text-muted truncate px-2">
          Сохранено в Obsidian ✓
        </p>
      )}

      {/* Round record button */}
      <div className="flex justify-center pb-2">
        <RecordBtn
          status={recStatus}
          onStart={startRec}
          onStop={stopRec}
          onPause={pauseRec}
          onResume={resumeRec}
          elapsed={elapsed}
        />
      </div>
    </div>
  );
}
