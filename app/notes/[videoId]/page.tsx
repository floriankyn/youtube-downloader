"use client";

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { useParams, useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────

interface TextBlock {
  id: string;
  type: "text";
  content: string;
}

interface VoiceBlock {
  id: string;
  type: "voice";
  audioBase64: string;
  mimeType: string;
  duration: number;
  createdAt: string;
  beatTimecode: number | null;
}

type Block = TextBlock | VoiceBlock;

interface Favorite {
  videoId: string;
  title: string;
  thumbnail: string;
  duration: string;
  url: string;
  bpm: string | null;
  key: string | null;
  beatType: string | null;
  inspiredBy: string[];
  tags: string[];
}

// ─── Helpers ─────────────────────────────────────────────────

function nanoid() {
  return Math.random().toString(36).slice(2, 10);
}

function getSupportedMimeType(): string {
  const types = ["audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Voice Recorder Hook ──────────────────────────────────────
// onDoneRef pattern: recorder.onstop always calls the *current* callback,
// never a stale one captured at recording-start time.

function useRecorder(
  onDone: (base64: string, mimeType: string, duration: number) => void,
  inputDeviceId?: string,
) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone; // keep fresh every render, no effect needed

  const inputDeviceIdRef = useRef(inputDeviceId);
  inputDeviceIdRef.current = inputDeviceId;

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const start = useCallback(async () => {
    const deviceId = inputDeviceIdRef.current;
    const audioConstraint = deviceId ? { deviceId: { ideal: deviceId } } : true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      startTimeRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const duration = (Date.now() - startTimeRef.current) / 1000;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        const base64 = await blobToBase64(blob);
        stream.getTracks().forEach((t) => t.stop());
        onDoneRef.current(base64, recorder.mimeType, duration); // always latest
      };

      recorder.start(100);
      recorderRef.current = recorder;
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed((Date.now() - startTimeRef.current) / 1000);
      }, 100);
    } catch {
      alert("Microphone access denied.");
    }
  }, []); // stable — no deps needed thanks to ref

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    setElapsed(0);
  }, []);

  return { recording, elapsed, start, stop };
}

// ─── Voice Block Player ───────────────────────────────────────

function VoicePlayer({
  block, onDelete, onPlayWithBeat, outputDeviceId,
}: {
  block: VoiceBlock;
  onDelete: () => void;
  onPlayWithBeat?: (timecode: number) => void;
  outputDeviceId?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [withBeat, setWithBeat] = useState(false);
  const [progress, setProgress] = useState(0);
  const src = `data:${block.mimeType};base64,${block.audioBase64}`;

  useEffect(() => {
    const audio = audioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!audio || !outputDeviceId || typeof audio.setSinkId !== "function") return;
    audio.setSinkId(outputDeviceId).catch(() => {});
  }, [outputDeviceId]);

  function playVoice() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setWithBeat(false); return; }
    audio.currentTime = 0;
    audio.play();
    setWithBeat(false);
  }

  function playBoth() {
    if (block.beatTimecode === null || !onPlayWithBeat) return;
    const audio = audioRef.current;
    if (!audio) return;
    if (playing && withBeat) { audio.pause(); setWithBeat(false); return; }
    audio.currentTime = 0;
    audio.play();
    setWithBeat(true);
    onPlayWithBeat(block.beatTimecode);
  }

  const hasBeat = block.beatTimecode !== null && !!onPlayWithBeat;

  return (
    <div className="rounded-xl bg-zinc-100 px-4 py-3 dark:bg-zinc-800 group">
      <audio
        ref={audioRef}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => { setPlaying(false); setWithBeat(false); }}
        onEnded={() => { setPlaying(false); setWithBeat(false); setProgress(0); }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          const dur = isFinite(a.duration) && a.duration > 0 ? a.duration : block.duration;
          if (dur) setProgress(a.currentTime / dur);
        }}
      />
      <div className="flex items-center gap-3">
        {/* Play voice only */}
        <button
          onClick={playVoice}
          title="Play voice note only"
          className={`flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full transition-colors ${
            playing && !withBeat
              ? "bg-red-600 text-white"
              : "bg-red-600 text-white hover:bg-red-700"
          }`}
        >
          {playing && !withBeat ? (
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <div className="flex-1 flex flex-col gap-1">
          <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
            <div className="h-full rounded-full bg-red-500 transition-all" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-400">
            <div className="flex items-center gap-1.5">
              <span>Voice note</span>
              {hasBeat && (
                <span className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
                  @ {formatDuration(block.beatTimecode!)}
                </span>
              )}
            </div>
            <span>{formatDuration(block.duration)}</span>
          </div>
        </div>

        {/* Play with beat */}
        {hasBeat && (
          <button
            onClick={playBoth}
            title="Play voice note + beat together"
            className={`flex-shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-medium transition-colors ${
              playing && withBeat
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-300 text-zinc-500 hover:border-zinc-500 hover:text-zinc-700 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-zinc-400"
            }`}
          >
            {playing && withBeat ? (
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
            + beat
          </button>
        )}

        <button
          onClick={onDelete}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-red-500"
          title="Delete voice note"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Insert Bar ───────────────────────────────────────────────

function parseMmSs(str: string): number | null {
  const colonIdx = str.indexOf(":");
  if (colonIdx !== -1) {
    const m = parseInt(str.slice(0, colonIdx), 10);
    const s = parseInt(str.slice(colonIdx + 1), 10);
    if (!isNaN(m) && !isNaN(s)) return m * 60 + s;
  }
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
}

function InsertBar({
  index, recording, elapsed, activeIndex,
  onStartRecord, onStopRecord, onInsertSection,
  onStartRecordWithBeat, getCurrentBeatTime, getBeatDuration,
  onPreviewBeat, onPauseBeat,
}: {
  index: number;
  recording: boolean;
  elapsed: number;
  activeIndex: number | null;
  onStartRecord: (index: number) => void;
  onStopRecord: () => void;
  onInsertSection: (index: number) => void;
  onStartRecordWithBeat: (index: number, timecode: number, leadIn: boolean) => void;
  getCurrentBeatTime: () => number;
  getBeatDuration: () => number;
  onPreviewBeat: (timecode: number) => void;
  onPauseBeat: () => void;
}) {
  const isActive = activeIndex === index;
  const [pickingBeat, setPickingBeat] = useState(false);
  const [beatSecs, setBeatSecs] = useState(0);
  const [beatInputStr, setBeatInputStr] = useState("0:00");
  const [previewing, setPreviewing] = useState(false);
  const [leadIn, setLeadIn] = useState(true);

  function updateSecs(secs: number, max = getBeatDuration() || 300) {
    const clamped = Math.max(0, Math.min(secs, max));
    setBeatSecs(clamped);
    setBeatInputStr(formatDuration(clamped));
    if (previewing) onPreviewBeat(clamped); // live-seek while previewing
  }

  function openBeatPicker() {
    const t = getCurrentBeatTime();
    setBeatSecs(t);
    setBeatInputStr(formatDuration(t));
    setPreviewing(false);
    setPickingBeat(true);
  }

  function handleTextChange(val: string) {
    setBeatInputStr(val);
    const parsed = parseMmSs(val);
    if (parsed !== null) {
      const clamped = Math.max(0, parsed);
      setBeatSecs(clamped);
      if (previewing) onPreviewBeat(clamped);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp")   { e.preventDefault(); updateSecs(beatSecs + 1); }
    if (e.key === "ArrowDown") { e.preventDefault(); updateSecs(beatSecs - 1); }
    if (e.key === "Enter")     { startWithBeat(); }
    if (e.key === "Escape")    { cancel(); }
  }

  function togglePreview() {
    if (previewing) {
      onPauseBeat();
      setPreviewing(false);
    } else {
      onPreviewBeat(beatSecs);
      setPreviewing(true);
    }
  }

  function startWithBeat() {
    setPreviewing(false);
    setPickingBeat(false);
    onStartRecordWithBeat(index, beatSecs, leadIn);
  }

  function cancel() {
    if (previewing) onPauseBeat();
    setPreviewing(false);
    setPickingBeat(false);
  }

  if (isActive && recording) {
    return (
      <div className="flex items-center gap-2 py-1">
        <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-800" />
        <button
          onClick={onStopRecord}
          className="flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
          </span>
          {formatDuration(elapsed)} — tap to save
        </button>
        <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-800" />
      </div>
    );
  }

  if (pickingBeat) {
    const sliderMax = getBeatDuration() || 300;
    return (
      <div className="py-2 px-1">
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900 space-y-2.5">
          {/* Row 1: label + timecode input + preview + actions */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 flex-shrink-0">
              Beat position
            </span>
            <input
              type="text"
              value={beatInputStr}
              onChange={(e) => handleTextChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="0:00"
              autoFocus
              className="w-14 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-center text-sm font-mono text-zinc-800 outline-none focus:border-red-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
            {/* Preview play/pause */}
            <button
              onClick={togglePreview}
              title={previewing ? "Pause preview" : "Preview beat at this position"}
              className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
                previewing
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-200 text-zinc-400 hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-600 dark:hover:border-zinc-400"
              }`}
            >
              {previewing ? (
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="w-3 h-3 translate-x-px" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <button
              onClick={() => setLeadIn((v) => !v)}
              title="5-second lead-in before your entry point"
              className={`flex-shrink-0 flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium transition-colors ${
                leadIn
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-200 text-zinc-400 dark:border-zinc-600"
              }`}
            >
              −5s
            </button>
            <div className="flex-1" />
            <button
              onClick={cancel}
              className="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 flex-shrink-0"
            >
              Cancel
            </button>
            <button
              onClick={startWithBeat}
              className="flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-red-700 flex-shrink-0"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              Record
            </button>
          </div>
          {/* Row 2: slider */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] tabular-nums text-zinc-300 dark:text-zinc-600 w-8 text-right flex-shrink-0">0:00</span>
            <input
              type="range"
              min={0}
              max={sliderMax}
              step={1}
              value={beatSecs}
              onChange={(e) => updateSecs(Number(e.target.value))}
              className="flex-1 h-1 appearance-none rounded-full cursor-pointer accent-red-500"
              style={{
                background: `linear-gradient(to right, rgb(239 68 68) ${(beatSecs / sliderMax) * 100}%, rgb(228 228 231) ${(beatSecs / sliderMax) * 100}%)`,
              }}
            />
            <span className="text-[10px] tabular-nums text-zinc-300 dark:text-zinc-600 w-8 flex-shrink-0">{formatDuration(sliderMax)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-1 group">
      <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-800 group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700 transition-colors" />
      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onInsertSection(index)}
          className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-400 hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500 dark:hover:border-zinc-500"
          title="Add a new section"
        >
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M12 5v14M5 12h14" />
          </svg>
          Section
        </button>
        <button
          onClick={() => onStartRecord(index)}
          disabled={recording}
          className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-400 hover:border-red-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500"
          title="Record a voice note"
        >
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2}>
            <rect x="9" y="2" width="6" height="11" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0M12 19v3M9 22h6" />
          </svg>
          Voice note
        </button>
        <button
          onClick={openBeatPicker}
          disabled={recording}
          className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-400 hover:border-red-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500"
          title="Record a voice note synced to a beat position"
        >
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2}>
            <rect x="9" y="2" width="6" height="11" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0M12 19v3M9 22h6" />
          </svg>
          <svg viewBox="0 0 24 24" className="w-3 h-3 -ml-1" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
          </svg>
          + beat
        </button>
      </div>
      <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-800 group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700 transition-colors" />
    </div>
  );
}

// ─── Auto-resize Textarea ─────────────────────────────────────

function AutoTextarea({
  value, onChange, onDelete, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onDelete?: () => void;
  placeholder: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  }, [value]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Backspace" && value === "" && onDelete) {
      e.preventDefault();
      onDelete();
    }
  }

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      rows={1}
      className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder-zinc-300 dark:placeholder-zinc-600"
      style={{ minHeight: "2rem" }}
    />
  );
}

// ─── Beat Player ─────────────────────────────────────────────

interface BeatPlayerHandle {
  getCurrentTime: () => number;
  getDuration: () => number;
  loadAndPlayFrom: (timecode: number) => Promise<void>;
  pause: () => void;
}

const BeatPlayer = forwardRef<BeatPlayerHandle, { url: string; title: string; outputDeviceId?: string }>(
function BeatPlayer({ url, title, outputDeviceId }, ref) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const statusRef = useRef<"idle" | "loading" | "ready">("idle");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [downloading, setDownloading] = useState(false);

  // Keep refs in sync for imperative access
  useEffect(() => { blobUrlRef.current = blobUrl; }, [blobUrl]);
  useEffect(() => { statusRef.current = status; }, [status]);

  useEffect(() => {
    const audio = audioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!audio || !outputDeviceId || typeof audio.setSinkId !== "function") return;
    audio.setSinkId(outputDeviceId).catch(() => {});
  }, [outputDeviceId]);

  // Lazy-load: only fetch when user first presses play
  async function load(): Promise<string | null> {
    setStatus("loading");
    statusRef.current = "loading";
    try {
      const res = await fetch(`/api/preview?${new URLSearchParams({ url })}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      setBlobUrl(obj);
      blobUrlRef.current = obj;
      setStatus("ready");
      statusRef.current = "ready";
      return obj;
    } catch {
      setStatus("idle");
      statusRef.current = "idle";
      return null;
    }
  }

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => audioRef.current?.currentTime ?? 0,
    getDuration: () => audioRef.current?.duration ?? 0,
    pause: () => { audioRef.current?.pause(); },
    loadAndPlayFrom: async (timecode: number) => {
      let src = blobUrlRef.current;
      if (statusRef.current === "idle") src = await load();
      if (statusRef.current === "loading") return; // still loading, ignore
      if (!src) return;
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.src !== src) audio.src = src;
      audio.currentTime = timecode;
      setCurrentTime(timecode);
      audio.play();
    },
  }));

  async function togglePlay() {
    let src = blobUrlRef.current;
    if (statusRef.current === "idle") src = await load();
    if (!src) return;

    const audio = audioRef.current;
    if (!audio) return;
    if (audio.src !== src) audio.src = src;

    playing ? audio.pause() : audio.play();
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/download?${new URLSearchParams({ url, format: "wav" })}`);
      if (!res.ok) throw new Error();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+)"/);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = match ? match[1] : `${title}.wav`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
    } catch {
      // silent
    } finally {
      setDownloading(false);
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const t = Number(e.target.value);
    audio.currentTime = t;
    setCurrentTime(t);
  }

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [blobUrl]);

  return (
    <div className="flex items-center gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
      {/* Play/pause */}
      <button
        onClick={togglePlay}
        disabled={status === "loading"}
        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-50 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {status === "loading" ? (
          <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin dark:border-zinc-900/30 dark:border-t-zinc-900" />
        ) : playing ? (
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 translate-x-px" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Time */}
      <span className="flex-shrink-0 text-[10px] tabular-nums text-zinc-400 w-8 text-right">
        {formatDuration(currentTime)}
      </span>

      {/* Seek bar */}
      <div className="flex-1 relative flex items-center">
        <input
          type="range"
          min={0}
          max={duration || 100}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          disabled={status !== "ready"}
          className="w-full h-1 appearance-none rounded-full cursor-pointer disabled:cursor-default accent-red-500"
          style={{
            background: duration
              ? `linear-gradient(to right, rgb(239 68 68) ${(currentTime / duration) * 100}%, rgb(228 228 231) ${(currentTime / duration) * 100}%)`
              : "rgb(228 228 231)",
          }}
        />
      </div>

      {/* Total duration */}
      <span className="flex-shrink-0 text-[10px] tabular-nums text-zinc-400 w-8">
        {duration ? formatDuration(duration) : "--:--"}
      </span>

      {/* Download */}
      <button
        onClick={handleDownload}
        disabled={downloading}
        title="Download as WAV"
        className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-40 transition-colors"
      >
        {downloading ? (
          <span className="w-3 h-3 rounded-full border-2 border-zinc-300 border-t-zinc-600 animate-spin" />
        ) : (
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 3v13M7 11l5 5 5-5" /><path d="M5 21h14" />
          </svg>
        )}
      </button>

      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
    </div>
  );
});

// ─── Beat Badges ─────────────────────────────────────────────

function BeatBadges({ fav }: { fav: Favorite }) {
  const hasBeatInfo = fav.beatType || fav.bpm || fav.key || fav.inspiredBy.length > 0;
  if (!hasBeatInfo) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {fav.beatType && (
        <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {fav.beatType}
        </span>
      )}
      {fav.bpm && (
        <span className="rounded-md bg-zinc-200 px-2 py-0.5 text-xs font-medium dark:bg-zinc-700">{fav.bpm}</span>
      )}
      {fav.key && (
        <span className="rounded-md bg-zinc-200 px-2 py-0.5 text-xs font-medium dark:bg-zinc-700">{fav.key}</span>
      )}
      {fav.inspiredBy.length > 0 && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Inspired by{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{fav.inspiredBy.join(", ")}</span>
        </span>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────

export default function NotesPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const router = useRouter();

  const [favorite, setFavorite] = useState<Favorite | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([{ id: nanoid(), type: "text", content: "" }]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [activeRecordIndex, setActiveRecordIndex] = useState<number | null>(null);

  // ── Audio devices ─────────────────────────────────────────
  const [showDevices, setShowDevices] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [inputDeviceId, setInputDeviceId] = useState<string>("");
  const [outputDeviceId, setOutputDeviceId] = useState<string>("");

  useEffect(() => {
    if (!showDevices) return;
    async function loadDevices() {
      try {
        // Brief permission request so enumeration returns real labels + IDs
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch {}
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        setAudioDevices(devs.filter((d) => d.kind === "audioinput" || d.kind === "audiooutput"));
      } catch {}
    }
    loadDevices();
  }, [showDevices]);

  // Ref so the recorder callback always reads the current index, never stale
  const activeRecordIndexRef = useRef<number | null>(null);
  // Captures beat position at recording start, read by insertVoiceBlock callback
  const beatTimecodeAtRecordStartRef = useRef<number | null>(null);
  // Imperative handle into BeatPlayer
  const beatPlayerRef = useRef<BeatPlayerHandle>(null);
  // Ref so save timeout always reads latest blocks, never stale
  const blocksRef = useRef<Block[]>(blocks);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep blocksRef in sync
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);

  // ── Load ──────────────────────────────────────────────────

  useEffect(() => {
    fetch(`/api/notes/${videoId}`)
      .then((r) => {
        if (r.status === 401 || r.status === 404) { router.replace("/?tab=favorites"); return null; }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        setFavorite(data.favorite);
        if (data.note?.blocks?.length) setBlocks(data.note.blocks as Block[]);
      })
      .finally(() => setLoading(false));
  }, [videoId, router]);

  // ── Save ──────────────────────────────────────────────────

  const save = useCallback(async (blocksToSave: Block[]) => {
    setSaveStatus("saving");
    try {
      await fetch(`/api/notes/${videoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: blocksToSave }),
      });
      setSaveStatus("saved");
    } catch {
      setSaveStatus("unsaved");
    }
  }, [videoId]);

  function scheduleSave(updated: Block[]) {
    setSaveStatus("unsaved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => save(updated), 1200);
  }

  // ── Block ops ─────────────────────────────────────────────

  function updateTextBlock(id: string, content: string) {
    setBlocks((prev) => {
      const updated = prev.map((b) => b.id === id && b.type === "text" ? { ...b, content } : b);
      scheduleSave(updated);
      return updated;
    });
  }

  function deleteBlock(id: string) {
    setBlocks((prev) => {
      const updated = prev.filter((b) => b.id !== id);
      const final = updated.length === 0
        ? [{ id: nanoid(), type: "text" as const, content: "" }]
        : updated;
      scheduleSave(final);
      return final;
    });
  }

  // Uses functional setBlocks so it always operates on current state,
  // not whatever `blocks` was when the recording started.
  function insertTextBlock(atIndex: number) {
    setBlocks((prev) => {
      const updated = [
        ...prev.slice(0, atIndex),
        { id: nanoid(), type: "text" as const, content: "" },
        ...prev.slice(atIndex),
      ];
      scheduleSave(updated);
      return updated;
    });
  }

  function insertVoiceBlock(atIndex: number, audioBase64: string, mimeType: string, duration: number, beatTimecode: number | null) {
    const voiceBlock: VoiceBlock = {
      id: nanoid(), type: "voice", audioBase64, mimeType, duration,
      createdAt: new Date().toISOString(), beatTimecode,
    };
    setBlocks((prev) => {
      const updated = [
        ...prev.slice(0, atIndex),
        voiceBlock,
        { id: nanoid(), type: "text" as const, content: "" },
        ...prev.slice(atIndex),
      ];
      // blocksRef will be updated by the useEffect above before the timeout fires
      scheduleSave(updated);
      return updated;
    });
    setActiveRecordIndex(null);
    activeRecordIndexRef.current = null;
  }

  // ── Recorder ─────────────────────────────────────────────
  // Reads activeRecordIndexRef — always the current index, never stale.

  const recorder = useRecorder((base64, mimeType, duration) => {
    const idx = activeRecordIndexRef.current;
    if (idx !== null) {
      insertVoiceBlock(idx, base64, mimeType, duration, beatTimecodeAtRecordStartRef.current);
    }
  }, inputDeviceId || undefined);

  function handleStartRecord(index: number) {
    activeRecordIndexRef.current = index;
    beatTimecodeAtRecordStartRef.current = null;
    setActiveRecordIndex(index);
    recorder.start();
  }

  function handleStartRecordWithBeat(index: number, chosenTimecode: number, leadIn: boolean) {
    const startTime = leadIn ? Math.max(0, chosenTimecode - 5) : chosenTimecode;
    activeRecordIndexRef.current = index;
    beatTimecodeAtRecordStartRef.current = startTime;
    setActiveRecordIndex(index);
    beatPlayerRef.current?.loadAndPlayFrom(startTime);
    recorder.start();
  }

  // ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-red-500" />
      </div>
    );
  }

  if (!favorite) return null;

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      {/* ── Sticky song header ── */}
      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="mx-auto max-w-2xl px-4 pt-3 pb-2 space-y-2">
          {/* Row 1: back / thumbnail / title / save status */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/?tab=favorites")}
              className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </button>
            <img src={favorite.thumbnail} alt="" className="flex-shrink-0 h-12 w-20 rounded-md object-cover" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight truncate">{favorite.title}</p>
              <BeatBadges fav={favorite} />
            </div>
            <span className={`flex-shrink-0 text-[10px] transition-colors ${
              saveStatus === "saving" ? "text-zinc-400" :
              saveStatus === "unsaved" ? "text-amber-500" :
              "text-zinc-300 dark:text-zinc-600"
            }`}>
              {saveStatus === "saving" ? "Saving…" : saveStatus === "unsaved" ? "Unsaved" : "Saved"}
            </span>
            {/* Device settings toggle */}
            <button
              onClick={() => setShowDevices((v) => !v)}
              title="Audio input / output settings"
              className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
                showDevices
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
              }`}
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
              </svg>
            </button>
          </div>

          {/* Row 2 (conditional): device selectors */}
          {showDevices && (
            <div className="flex items-center gap-3 pb-1">
              <div className="flex flex-1 items-center gap-2">
                <span className="flex-shrink-0 text-[10px] text-zinc-400">Mic</span>
                <select
                  value={inputDeviceId}
                  onChange={(e) => setInputDeviceId(e.target.value)}
                  className="flex-1 min-w-0 rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs text-zinc-700 outline-none focus:border-red-400 dark:border-zinc-700 dark:text-zinc-300"
                >
                  <option value="">System default</option>
                  {audioDevices.filter((d) => d.kind === "audioinput").map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone (${d.deviceId.slice(0, 6)})`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-1 items-center gap-2">
                <span className="flex-shrink-0 text-[10px] text-zinc-400">Output</span>
                <select
                  value={outputDeviceId}
                  onChange={(e) => setOutputDeviceId(e.target.value)}
                  className="flex-1 min-w-0 rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs text-zinc-700 outline-none focus:border-red-400 dark:border-zinc-700 dark:text-zinc-300"
                >
                  <option value="">System default</option>
                  {audioDevices.filter((d) => d.kind === "audiooutput").map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Speaker (${d.deviceId.slice(0, 6)})`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Row 3: beat player */}
          <BeatPlayer ref={beatPlayerRef} url={favorite.url} title={favorite.title} outputDeviceId={outputDeviceId || undefined} />
        </div>
      </div>

      {/* ── Editor ── */}
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-1">
        {blocks.map((block, i) => (
          <div key={block.id}>
            <InsertBar
              index={i}
              recording={recorder.recording}
              elapsed={recorder.elapsed}
              activeIndex={activeRecordIndex}
              onStartRecord={handleStartRecord}
              onStopRecord={recorder.stop}
              onInsertSection={insertTextBlock}
              onStartRecordWithBeat={handleStartRecordWithBeat}
              getCurrentBeatTime={() => beatPlayerRef.current?.getCurrentTime() ?? 0}
              getBeatDuration={() => beatPlayerRef.current?.getDuration() ?? 0}
              onPreviewBeat={(t) => beatPlayerRef.current?.loadAndPlayFrom(t)}
              onPauseBeat={() => beatPlayerRef.current?.pause()}
            />
            {block.type === "text" ? (
              <AutoTextarea
                value={block.content}
                onChange={(v) => updateTextBlock(block.id, v)}
                onDelete={blocks.length > 1 ? () => deleteBlock(block.id) : undefined}
                placeholder={i === 0 ? "Write your lyrics here…" : "Continue writing…"}
              />
            ) : (
              <VoicePlayer
                block={block}
                onDelete={() => deleteBlock(block.id)}
                outputDeviceId={outputDeviceId || undefined}
                onPlayWithBeat={block.beatTimecode !== null
                  ? (t) => beatPlayerRef.current?.loadAndPlayFrom(t)
                  : undefined}
              />
            )}
          </div>
        ))}
        <InsertBar
          index={blocks.length}
          recording={recorder.recording}
          elapsed={recorder.elapsed}
          activeIndex={activeRecordIndex}
          onStartRecord={handleStartRecord}
          onStopRecord={recorder.stop}
          onInsertSection={insertTextBlock}
          onStartRecordWithBeat={handleStartRecordWithBeat}
          getCurrentBeatTime={() => beatPlayerRef.current?.getCurrentTime() ?? 0}
          getBeatDuration={() => beatPlayerRef.current?.getDuration() ?? 0}
          onPreviewBeat={(t) => beatPlayerRef.current?.loadAndPlayFrom(t)}
          onPauseBeat={() => beatPlayerRef.current?.pause()}
        />
      </div>
    </div>
  );
}
