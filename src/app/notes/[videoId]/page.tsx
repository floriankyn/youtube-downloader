"use client";

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { io, type Socket } from "socket.io-client";

// ─── Constants ───────────────────────────────────────────────

const MUSICAL_KEYS = [
  "C major", "C minor", "C# major", "C# minor",
  "D major", "D minor", "D# major", "D# minor",
  "E major", "E minor", "F major", "F minor",
  "F# major", "F# minor", "G major", "G minor",
  "G# major", "G# minor", "A major", "A minor",
  "A# major", "A# minor", "B major", "B minor",
];

const BEAT_TYPES = [
  "Trap", "Drill", "UK Drill", "NY Drill", "Boom Bap", "Lo-Fi",
  "R&B", "Soul", "Jazz", "Afrobeat", "Reggaeton", "Dancehall",
  "Pop", "Rock", "Dark", "Melodic", "Hard", "Chill",
  "Ambient", "Plugg", "Rage", "Hyperpop", "Jersey Club", "Phonk",
  "Memphis", "West Coast", "East Coast", "Southern", "Orchestral",
  "Cinematic", "Emotional", "Sad", "Hype", "Bouncy", "Smooth",
];

function parseBpmNumber(bpmStr: string | null): number {
  if (!bpmStr) return 0;
  const m = bpmStr.match(/(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

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
  sectionTag: string | null;
}

interface Timecode {
  id: string;
  time: number;   // seconds
  label: string;
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
  // Prefer explicit Opus codec for consistent quality across browsers
  const types = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
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

function getSectionAtTime(timecodes: Timecode[], time: number): string | null {
  const sorted = [...timecodes].sort((a, b) => a.time - b.time);
  let label: string | null = null;
  for (const tc of sorted) {
    if (tc.time <= time) label = tc.label;
    else break;
  }
  return label;
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

    // Always disable browser voice-call processing — it wrecks audio quality
    // when recording over music (AGC ducks the signal, NR kills frequencies).
    const baseAudioConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: 48000,
      channelCount: 2, // prevent mono-left playback; browser upmixes if mic is mono
    };

    // Try the selected device with `exact` (hard enforcement) first.
    // Fall back to `ideal` (soft hint) if the device is unavailable,
    // then fall back to system default if both fail.
    let stream: MediaStream | null = null;
    if (deviceId) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { ...baseAudioConstraints, deviceId: { exact: deviceId } },
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { ...baseAudioConstraints, deviceId: { ideal: deviceId } },
          });
        } catch {
          // fall through to default below
        }
      }
    }
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: baseAudioConstraints });
      } catch {
        alert("Microphone access denied.");
        return;
      }
    }

    try {
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(
        stream,
        { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 128000 }
      );
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
      stream.getTracks().forEach((t) => t.stop());
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
            <div className="flex items-center gap-1.5 flex-wrap">
              <span>Voice note</span>
              {block.sectionTag && (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400">
                  {block.sectionTag}
                </span>
              )}
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
  isPlaying: () => boolean;
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
    isPlaying: () => !!(audioRef.current && !audioRef.current.paused),
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

// ─── Timecode Timeline ────────────────────────────────────────

function TimecodeTimeline({
  timecodes, beatPlayerRef, onEdit,
}: {
  timecodes: Timecode[];
  beatPlayerRef: React.RefObject<BeatPlayerHandle | null>;
  onEdit: () => void;
}) {
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    let raf: number;
    function tick() {
      setCurrentTime(beatPlayerRef.current?.getCurrentTime() ?? 0);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [beatPlayerRef]);

  const sorted = useMemo(() => [...timecodes].sort((a, b) => a.time - b.time), [timecodes]);
  const dur = beatPlayerRef.current?.getDuration() || (sorted.length > 0 ? sorted[sorted.length - 1].time + 30 : 300);
  const progress = dur > 0 ? Math.min(1, currentTime / dur) : 0;

  // active section: last timecode whose time <= currentTime
  let activeTcId: string | null = null;
  for (const tc of sorted) {
    if (tc.time <= currentTime) activeTcId = tc.id;
    else break;
  }

  function handleBarClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    beatPlayerRef.current?.loadAndPlayFrom(frac * dur);
  }

  if (timecodes.length === 0) {
    return (
      <div className="flex items-center gap-3 pt-1.5 border-t border-zinc-100 dark:border-zinc-800">
        <span className="text-[10px] text-zinc-300 dark:text-zinc-600 flex-1">No timecodes</span>
        <button onClick={onEdit} className="text-[10px] text-red-500 hover:text-red-600 font-medium">
          + Detect / Add
        </button>
      </div>
    );
  }

  return (
    <div className="pt-1.5 border-t border-zinc-100 dark:border-zinc-800 space-y-1">
      {/* Label chips */}
      <div className="relative h-5">
        {sorted.map((tc) => {
          const pct = Math.min(99, (tc.time / dur) * 100);
          const isActive = tc.id === activeTcId;
          return (
            <span
              key={tc.id}
              className={`absolute -translate-x-1/2 text-[9px] font-medium whitespace-nowrap transition-colors select-none ${
                isActive ? "text-red-500" : "text-zinc-400 dark:text-zinc-500"
              }`}
              style={{ left: `${pct}%` }}
            >
              {tc.label}
            </span>
          );
        })}
      </div>
      {/* Seekable bar */}
      <div className="flex items-center gap-2">
        <div
          className="relative flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 cursor-pointer overflow-visible"
          onClick={handleBarClick}
        >
          {/* Filled progress */}
          <div className="absolute h-full rounded-full bg-red-500 pointer-events-none" style={{ width: `${progress * 100}%` }} />
          {/* Section markers */}
          {sorted.map((tc) => {
            const pct = Math.min(99, (tc.time / dur) * 100);
            return (
              <div
                key={tc.id}
                className="absolute top-1/2 w-px h-3 -translate-y-1/2 bg-zinc-400 dark:bg-zinc-500 pointer-events-none"
                style={{ left: `${pct}%` }}
              />
            );
          })}
          {/* Playhead */}
          <div
            className="absolute top-1/2 w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white border-2 border-red-500 shadow-sm pointer-events-none"
            style={{ left: `${progress * 100}%` }}
          />
        </div>
        <button onClick={onEdit} title="Edit timecodes" className="flex-shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Timecode Editor ──────────────────────────────────────────

function TimecodeEditor({
  timecodes, onChange, onDetect, detecting, beatPlayerRef, onClose,
}: {
  timecodes: Timecode[];
  onChange: (tcs: Timecode[]) => void;
  onDetect: () => void;
  detecting: boolean;
  beatPlayerRef: React.RefObject<BeatPlayerHandle | null>;
  onClose: () => void;
}) {
  const sorted = useMemo(() => [...timecodes].sort((a, b) => a.time - b.time), [timecodes]);

  function addAtCurrentTime() {
    const t = Math.round(beatPlayerRef.current?.getCurrentTime() ?? 0);
    onChange([...timecodes, { id: nanoid(), time: t, label: "" }]);
  }

  function updateLabel(id: string, label: string) {
    onChange(timecodes.map((tc) => tc.id === id ? { ...tc, label } : tc));
  }

  function updateTime(id: string, val: string) {
    const parsed = parseMmSs(val);
    if (parsed !== null) {
      onChange(timecodes.map((tc) => tc.id === id ? { ...tc, time: Math.max(0, parsed) } : tc));
    }
  }

  function remove(id: string) {
    onChange(timecodes.filter((tc) => tc.id !== id));
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Timecodes</span>
        <div className="flex items-center gap-3">
          <button
            onClick={onDetect}
            disabled={detecting}
            className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 disabled:opacity-50"
          >
            {detecting ? (
              <span className="w-2.5 h-2.5 rounded-full border border-zinc-400 border-t-transparent animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
            )}
            Detect from video
          </button>
          <button
            onClick={addAtCurrentTime}
            className="text-[10px] rounded-full border border-zinc-300 px-2 py-0.5 text-zinc-500 hover:border-zinc-500 hover:text-zinc-700 dark:border-zinc-600 dark:hover:border-zinc-400"
          >
            + Add at {formatDuration(beatPlayerRef.current?.getCurrentTime() ?? 0)}
          </button>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      {sorted.length === 0 ? (
        <p className="text-[10px] text-zinc-400">No timecodes yet. Click "Detect from video" to auto-import from the description, or "Add" to create one manually.</p>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((tc) => (
            <div key={tc.id} className="flex items-center gap-2">
              <input
                type="text"
                defaultValue={formatDuration(tc.time)}
                onBlur={(e) => updateTime(tc.id, e.target.value)}
                className="w-14 shrink-0 rounded border border-zinc-200 bg-white px-1.5 py-1 text-center text-xs font-mono outline-none focus:border-red-400 dark:border-zinc-600 dark:bg-zinc-800"
              />
              <input
                type="text"
                value={tc.label}
                onChange={(e) => updateLabel(tc.id, e.target.value)}
                placeholder="Label…"
                className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-red-400 dark:border-zinc-600 dark:bg-zinc-800"
              />
              <button onClick={() => remove(tc.id)} className="shrink-0 text-zinc-400 hover:text-red-500 transition-colors">
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const searchParams = useSearchParams();
  const collabToken = searchParams.get("collab"); // present when opened as collaborator
  const isCollaborator = !!collabToken;

  const [favorite, setFavorite] = useState<Favorite | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([{ id: nanoid(), type: "text", content: "" }]);
  const [timecodes, setTimecodes] = useState<Timecode[]>([]);
  const [showTimecodeEditor, setShowTimecodeEditor] = useState(false);
  const [detectingTimecodes, setDetectingTimecodes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [activeRecordIndex, setActiveRecordIndex] = useState<number | null>(null);

  // ── Song / beat metadata (user-editable) ─────────────────────
  const [songName, setSongName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [publicId, setPublicId] = useState<string | null>(null);
  const [noteBpm, setNoteBpm] = useState("");
  const [noteKey, setNoteKey] = useState("");
  const [noteBeatType, setNoteBeatType] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [videoThumbnail, setVideoThumbnail] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);

  // ── Collaboration ─────────────────────────────────────────
  const [editToken, setEditToken] = useState<string | null>(null);
  const [peers, setPeers] = useState<{ id: string; email: string }[]>([]);
  const [showCollabPanel, setShowCollabPanel] = useState(false);
  const [collabLinkCopied, setCollabLinkCopied] = useState(false);
  const [generatingToken, setGeneratingToken] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const activeToken = editToken ?? collabToken;

  // ── Audio devices ─────────────────────────────────────────
  const [reanalyzing, setReanalyzing] = useState(false);
  const [showReanalyzeConfirm, setShowReanalyzeConfirm] = useState(false);
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
  // Captures the active timecode section label at recording start
  const sectionTagAtRecordStartRef = useRef<string | null>(null);
  // Imperative handle into BeatPlayer
  const beatPlayerRef = useRef<BeatPlayerHandle>(null);
  // Refs so save timeout always reads latest values, never stale
  const blocksRef = useRef<Block[]>(blocks);
  const timecodesRef = useRef<Timecode[]>(timecodes);
  const songNameRef = useRef("");
  const isPublicRef = useRef(false);
  const publicIdRef = useRef<string | null>(null);
  const noteBpmRef = useRef("");
  const noteKeyRef = useRef("");
  const noteBeatTypeRef = useRef("");
  const videoTitleRef = useRef("");
  const videoThumbnailRef = useRef("");
  const videoUrlRef = useRef("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  useEffect(() => { timecodesRef.current = timecodes; }, [timecodes]);
  useEffect(() => { songNameRef.current = songName; }, [songName]);
  useEffect(() => { isPublicRef.current = isPublic; }, [isPublic]);
  useEffect(() => { publicIdRef.current = publicId; }, [publicId]);
  useEffect(() => { noteBpmRef.current = noteBpm; }, [noteBpm]);
  useEffect(() => { noteKeyRef.current = noteKey; }, [noteKey]);
  useEffect(() => { noteBeatTypeRef.current = noteBeatType; }, [noteBeatType]);
  useEffect(() => { videoTitleRef.current = videoTitle; }, [videoTitle]);
  useEffect(() => { videoThumbnailRef.current = videoThumbnail; }, [videoThumbnail]);
  useEffect(() => { videoUrlRef.current = videoUrl; }, [videoUrl]);

  // ── Load ──────────────────────────────────────────────────

  useEffect(() => {
    const fetchUrl = isCollaborator
      ? `/api/collab/${collabToken}`
      : `/api/notes/${videoId}`;

    fetch(fetchUrl)
      .then((r) => {
        if (r.status === 401 || r.status === 404) { router.replace("/?tab=favorites"); return null; }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        setFavorite(data.favorite);
        if (data.note?.blocks?.length) setBlocks(data.note.blocks as Block[]);
        if (data.note?.timecodes?.length) setTimecodes(data.note.timecodes as Timecode[]);
        // Restore editToken for owner (so Socket.io auto-joins the room they already shared)
        // and set it for collaborators (so Socket.io connects using their invite token)
        if (!isCollaborator && data.note?.editToken) setEditToken(data.note.editToken);
        if (isCollaborator && collabToken) setEditToken(collabToken);

        // Song / beat metadata — note values take priority, fall back to favorite
        const note = data.note;
        const fav = data.favorite;
        if (note?.songName) setSongName(note.songName);
        if (note?.isPublic) setIsPublic(true);
        if (note?.publicId) { setPublicId(note.publicId); publicIdRef.current = note.publicId; }
        // BPM/key/beatType: use note value if set, else favorite
        const bpm = note?.bpm ?? fav?.bpm ?? "";
        const key = note?.key ?? fav?.key ?? "";
        const bt = note?.beatType ?? fav?.beatType ?? "";
        setNoteBpm(bpm); noteBpmRef.current = bpm;
        setNoteKey(key); noteKeyRef.current = key;
        setNoteBeatType(bt); noteBeatTypeRef.current = bt;
        // Cache video info for orphan access (note without favorite)
        const title = fav?.title ?? note?.videoTitle ?? "";
        const thumb = fav?.thumbnail ?? note?.videoThumbnail ?? "";
        const url = fav?.url ?? note?.videoUrl ?? "";
        setVideoTitle(title); videoTitleRef.current = title;
        setVideoThumbnail(thumb); videoThumbnailRef.current = thumb;
        setVideoUrl(url); videoUrlRef.current = url;
      })
      .finally(() => setLoading(false));
  }, [videoId, router]);

  // ── Save ──────────────────────────────────────────────────

  const save = useCallback(async () => {
    // Collaborators don't own the note — the Socket.io server handles persistence
    if (isCollaborator) { setSaveStatus("saved"); return; }
    setSaveStatus("saving");
    try {
      await fetch(`/api/notes/${videoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blocks: blocksRef.current,
          timecodes: timecodesRef.current,
          songName: songNameRef.current || null,
          isPublic: isPublicRef.current,
          publicId: publicIdRef.current,
          bpm: noteBpmRef.current || null,
          key: noteKeyRef.current || null,
          beatType: noteBeatTypeRef.current || null,
          videoTitle: videoTitleRef.current || null,
          videoThumbnail: videoThumbnailRef.current || null,
          videoUrl: videoUrlRef.current || null,
        }),
      });
      setSaveStatus("saved");
    } catch {
      setSaveStatus("unsaved");
    }
  }, [videoId, isCollaborator]);

  function scheduleSave() {
    setSaveStatus("unsaved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => save(), 1200);
  }

  // ── Socket.io ─────────────────────────────────────────────

  useEffect(() => {
    if (!activeToken) return;

    const socket = io({ path: "/socket.io", transports: ["polling", "websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join-room", activeToken);
    });

    socket.on("connect_error", (err) => {
      console.error("[collab] connection error:", err.message);
    });

    socket.on("room-state", ({ blocks: remoteBlocks, timecodes: remoteTcs, peers: remotePeers }: {
      blocks: Block[]; timecodes: Timecode[]; peers: { id: string; email: string }[];
    }) => {
      // Only apply remote state if it's non-empty (don't overwrite local content with empty)
      if (remoteBlocks?.length) {
        setBlocks(remoteBlocks);
        blocksRef.current = remoteBlocks;
      }
      if (remoteTcs?.length) {
        setTimecodes(remoteTcs);
        timecodesRef.current = remoteTcs;
      }
      setPeers(remotePeers ?? []);
    });

    socket.on("blocks-update", ({ blocks: remoteBlocks }: { blocks: Block[]; fromPeerId: string }) => {
      setBlocks(remoteBlocks);
      blocksRef.current = remoteBlocks;
      // Owner: schedule a REST save so remote edits are also persisted client-side
      if (!isCollaborator) scheduleSave();
    });

    socket.on("timecodes-update", ({ timecodes: remoteTcs }: { timecodes: Timecode[]; fromPeerId: string }) => {
      setTimecodes(remoteTcs);
      timecodesRef.current = remoteTcs;
    });

    socket.on("peer-joined", (peer: { id: string; email: string }) => {
      setPeers((prev) => [...prev.filter((p) => p.id !== peer.id), peer]);
    });

    socket.on("peer-left", ({ id }: { id: string }) => {
      setPeers((prev) => prev.filter((p) => p.id !== id));
    });

    return () => { socket.disconnect(); socketRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeToken]);

  function emitBlocks(updated: Block[]) {
    socketRef.current?.emit("blocks-update", updated);
  }

  function emitTimecodes(updated: Timecode[]) {
    socketRef.current?.emit("timecodes-update", updated);
  }

  async function generateCollabLink() {
    setGeneratingToken(true);
    try {
      const res = await fetch(`/api/notes/${videoId}/collab`, { method: "POST" });
      const data = await res.json();
      if (data.editToken) setEditToken(data.editToken);
    } finally {
      setGeneratingToken(false);
    }
  }

  async function revokeCollabLink() {
    await fetch(`/api/notes/${videoId}/collab`, { method: "DELETE" });
    setEditToken(null);
    setPeers([]);
    socketRef.current?.disconnect();
    socketRef.current = null;
  }

  function updateTimecodes(updated: Timecode[]) {
    setTimecodes(updated);
    timecodesRef.current = updated;
    emitTimecodes(updated);
    scheduleSave();
  }

  async function reanalyze() {
    const url = videoUrlRef.current || favorite?.url;
    if (!url || reanalyzing) return;
    setReanalyzing(true);
    try {
      const res = await fetch(`/api/analyze?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();

      // Update note-level beat metadata
      const newBpm = data.bpm ?? noteBpmRef.current;
      const newKey = data.key ?? noteKeyRef.current;
      const newBt = data.beatType ?? noteBeatTypeRef.current;
      setNoteBpm(newBpm); noteBpmRef.current = newBpm;
      setNoteKey(newKey); noteKeyRef.current = newKey;
      setNoteBeatType(newBt); noteBeatTypeRef.current = newBt;

      // Also update favorite state if present
      if (favorite) {
        const updated = {
          ...favorite,
          bpm: newBpm,
          key: newKey,
          beatType: newBt,
          inspiredBy: data.inspiredBy?.length ? data.inspiredBy : favorite.inspiredBy,
          tags: data.tags?.length ? data.tags : favorite.tags,
        };
        setFavorite(updated);
        await fetch("/api/favorites", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            videoId: favorite.videoId,
            bpm: updated.bpm,
            key: updated.key,
            beatType: updated.beatType,
            inspiredBy: updated.inspiredBy,
            tags: updated.tags,
          }),
        });
      }

      // Refresh timecodes if found
      if (Array.isArray(data.timecodes) && data.timecodes.length > 0) {
        const tcs: Timecode[] = data.timecodes.map((t: { time: number; label: string }) => ({
          id: nanoid(), time: t.time, label: t.label,
        }));
        updateTimecodes(tcs);
      }

      scheduleSave();
    } catch {
      // silent — user sees no change
    } finally {
      setReanalyzing(false);
    }
  }

  async function detectTimecodes() {
    if (!favorite) return;
    setDetectingTimecodes(true);
    try {
      const res = await fetch(`/api/analyze?url=${encodeURIComponent(favorite.url)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (Array.isArray(data.timecodes) && data.timecodes.length > 0) {
        const tcs: Timecode[] = data.timecodes.map((t: { time: number; label: string }) => ({
          id: nanoid(), time: t.time, label: t.label,
        }));
        updateTimecodes(tcs);
      }
    } catch {
      // silent — user can add manually
    } finally {
      setDetectingTimecodes(false);
    }
  }

  // ── Block ops ─────────────────────────────────────────────

  function updateTextBlock(id: string, content: string) {
    const updated = blocksRef.current.map((b) => b.id === id && b.type === "text" ? { ...b, content } : b);
    blocksRef.current = updated;
    setBlocks(updated);
    emitBlocks(updated);
    scheduleSave();
  }

  function deleteBlock(id: string) {
    const filtered = blocksRef.current.filter((b) => b.id !== id);
    const updated = filtered.length === 0
      ? [{ id: nanoid(), type: "text" as const, content: "" }]
      : filtered;
    blocksRef.current = updated;
    setBlocks(updated);
    emitBlocks(updated);
    scheduleSave();
  }

  function insertTextBlock(atIndex: number) {
    const current = blocksRef.current;
    const updated = [
      ...current.slice(0, atIndex),
      { id: nanoid(), type: "text" as const, content: "" },
      ...current.slice(atIndex),
    ];
    blocksRef.current = updated;
    setBlocks(updated);
    emitBlocks(updated);
    scheduleSave();
  }

  function insertVoiceBlock(atIndex: number, audioBase64: string, mimeType: string, duration: number, beatTimecode: number | null, sectionTag: string | null) {
    const voiceBlock: VoiceBlock = {
      id: nanoid(), type: "voice", audioBase64, mimeType, duration,
      createdAt: new Date().toISOString(), beatTimecode, sectionTag,
    };
    const current = blocksRef.current;
    const updated = [
      ...current.slice(0, atIndex),
      voiceBlock,
      { id: nanoid(), type: "text" as const, content: "" },
      ...current.slice(atIndex),
    ];
    blocksRef.current = updated;
    setBlocks(updated);
    emitBlocks(updated);
    scheduleSave();
    setActiveRecordIndex(null);
    activeRecordIndexRef.current = null;
  }

  // ── Recorder ─────────────────────────────────────────────
  // Reads activeRecordIndexRef — always the current index, never stale.

  const recorder = useRecorder((base64, mimeType, duration) => {
    const idx = activeRecordIndexRef.current;
    if (idx !== null) {
      insertVoiceBlock(idx, base64, mimeType, duration, beatTimecodeAtRecordStartRef.current, sectionTagAtRecordStartRef.current);
    }
  }, inputDeviceId || undefined);

  function handleStartRecord(index: number) {
    activeRecordIndexRef.current = index;
    beatTimecodeAtRecordStartRef.current = null;
    // Auto-tag if beat is actively playing
    const isPlaying = beatPlayerRef.current?.isPlaying() ?? false;
    sectionTagAtRecordStartRef.current = isPlaying
      ? getSectionAtTime(timecodesRef.current, beatPlayerRef.current?.getCurrentTime() ?? 0)
      : null;
    setActiveRecordIndex(index);
    recorder.start();
  }

  function handleStartRecordWithBeat(index: number, chosenTimecode: number, leadIn: boolean) {
    const startTime = leadIn ? Math.max(0, chosenTimecode - 5) : chosenTimecode;
    activeRecordIndexRef.current = index;
    beatTimecodeAtRecordStartRef.current = startTime;
    // Tag with the section at the chosen entry point (not the lead-in start)
    sectionTagAtRecordStartRef.current = getSectionAtTime(timecodesRef.current, chosenTimecode);
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

  // Allow rendering if we have either a favorite or cached video info from the note
  if (!favorite && !videoTitle) return null;

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
            {videoThumbnail && (
              <img src={videoThumbnail} alt="" className="flex-shrink-0 h-12 w-20 rounded-md object-cover" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight truncate">{videoTitle}</p>
              <BeatBadges fav={{ videoId: favorite?.videoId ?? videoId, title: favorite?.title ?? videoTitle, thumbnail: favorite?.thumbnail ?? videoThumbnail, duration: favorite?.duration ?? "", url: favorite?.url ?? videoUrl, bpm: noteBpm || favorite?.bpm || null, key: noteKey || favorite?.key || null, beatType: noteBeatType || favorite?.beatType || null, inspiredBy: favorite?.inspiredBy ?? [], tags: favorite?.tags ?? [] }} />
            </div>
            <span className={`flex-shrink-0 text-[10px] transition-colors ${
              saveStatus === "saving" ? "text-zinc-400" :
              saveStatus === "unsaved" ? "text-amber-500" :
              "text-zinc-300 dark:text-zinc-600"
            }`}>
              {saveStatus === "saving" ? "Saving…" : saveStatus === "unsaved" ? "Unsaved" : "Saved"}
            </span>
            {/* Re-analyze */}
            <button
              onClick={() => setShowReanalyzeConfirm(true)}
              disabled={reanalyzing}
              title="Re-analyze beat metadata and timecodes"
              className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-40 dark:hover:bg-zinc-800 transition-colors"
            >
              <svg
                viewBox="0 0 24 24"
                className={`w-3.5 h-3.5 ${reanalyzing ? "animate-spin" : ""}`}
                fill="none" stroke="currentColor" strokeWidth={2}
              >
                <path d="M23 4v6h-6" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
            {/* Visibility toggle */}
            <button
              onClick={() => {
                const next = !isPublic;
                let pid = publicId;
                if (next && !pid) {
                  pid = nanoid() + nanoid();
                  setPublicId(pid);
                  publicIdRef.current = pid;
                }
                setIsPublic(next);
                isPublicRef.current = next;
                scheduleSave();
              }}
              title={isPublic ? "Public — click to make private" : "Private — click to make public"}
              className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
                isPublic
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
              }`}
            >
              {isPublic ? (
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              )}
            </button>
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

            {/* Collaborate toggle (hidden for collaborators — they can't manage the link) */}
            {!isCollaborator && (
              <button
                onClick={() => setShowCollabPanel((v) => !v)}
                title="Collaborate in real-time"
                className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
                  showCollabPanel || activeToken
                    ? "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400"
                    : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                }`}
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </button>
            )}

            {/* Peer presence avatars */}
            {peers.length > 0 && (
              <div className="flex-shrink-0 flex items-center -space-x-1.5">
                {peers.slice(0, 4).map((peer) => (
                  <div
                    key={peer.id}
                    title={peer.email}
                    className="w-6 h-6 rounded-full bg-blue-500 border-2 border-white dark:border-zinc-950 flex items-center justify-center text-[9px] font-bold text-white uppercase select-none"
                  >
                    {peer.email[0]}
                  </div>
                ))}
                {peers.length > 4 && (
                  <div className="w-6 h-6 rounded-full bg-zinc-300 dark:bg-zinc-700 border-2 border-white dark:border-zinc-950 flex items-center justify-center text-[9px] font-bold text-zinc-600 dark:text-zinc-300">
                    +{peers.length - 4}
                  </div>
                )}
              </div>
            )}
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

          {/* Row 3 (conditional): collaboration panel */}
          {showCollabPanel && !isCollaborator && (
            <div className="flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/30 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">Real-time collaboration</span>
                {activeToken && (
                  <button onClick={revokeCollabLink} className="text-[10px] text-red-500 hover:underline">Revoke link</button>
                )}
              </div>
              {!activeToken ? (
                <button
                  onClick={generateCollabLink}
                  disabled={generatingToken}
                  className="self-start rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {generatingToken ? "Generating…" : "Generate invite link"}
                </button>
              ) : (
                <>
                  <div className="flex items-center gap-2 rounded-md bg-white dark:bg-zinc-900 border border-blue-200 dark:border-blue-900/40 px-2.5 py-1.5">
                    <span className="flex-1 text-[10px] font-mono text-zinc-600 dark:text-zinc-400 truncate">
                      {typeof window !== "undefined"
                        ? `${window.location.origin}/notes/${videoId}?collab=${activeToken}`
                        : `/notes/${videoId}?collab=${activeToken}`}
                    </span>
                    <button
                      onClick={() => {
                        const link = `${window.location.origin}/notes/${videoId}?collab=${activeToken}`;
                        navigator.clipboard.writeText(link);
                        setCollabLinkCopied(true);
                        setTimeout(() => setCollabLinkCopied(false), 2000);
                      }}
                      className="flex-shrink-0 text-[10px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {collabLinkCopied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  {peers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {peers.map((peer) => (
                        <span key={peer.id} className="flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 text-[10px] text-blue-700 dark:text-blue-300">
                          <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                          {peer.email}
                        </span>
                      ))}
                    </div>
                  )}
                  {peers.length === 0 && (
                    <p className="text-[10px] text-blue-500 dark:text-blue-400">Share the link above — collaborators will appear here when they join.</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Collaborator banner */}
          {isCollaborator && (
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 px-3 py-1.5 text-xs text-blue-700 dark:text-blue-400">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Collaborating in real-time
              {peers.length > 0 && <span className="ml-1 opacity-70">· {peers.length + 1} people editing</span>}
            </div>
          )}

          {/* Share link row — visible when public */}
          {isPublic && publicId && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 dark:bg-green-900/20 px-3 py-1.5">
              <svg viewBox="0 0 24 24" className="flex-shrink-0 w-3.5 h-3.5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <span className="flex-1 text-xs text-green-700 dark:text-green-400 truncate font-mono">
                {typeof window !== "undefined" ? `${window.location.origin}/view/${publicId}` : `/view/${publicId}`}
              </span>
              <button
                onClick={() => {
                  const link = `${window.location.origin}/view/${publicId}`;
                  navigator.clipboard.writeText(link).then(() => {
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 2000);
                  });
                }}
                className="flex-shrink-0 text-xs font-medium text-green-700 dark:text-green-400 hover:underline"
              >
                {linkCopied ? "Copied!" : "Copy"}
              </button>
            </div>
          )}

          {/* Row 3: beat player */}
          <BeatPlayer ref={beatPlayerRef} url={videoUrl || favorite?.url || ""} title={videoTitle} outputDeviceId={outputDeviceId || undefined} />
          {/* Row 4: timecode timeline */}
          <TimecodeTimeline
            timecodes={timecodes}
            beatPlayerRef={beatPlayerRef}
            onEdit={() => setShowTimecodeEditor((v) => !v)}
          />
        </div>
      </div>

      {/* ── Editor ── */}
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-1">
        {/* Song name + beat info */}
        <div className="mb-6 space-y-3">
          <input
            type="text"
            value={songName}
            onChange={(e) => {
              const v = e.target.value;
              setSongName(v);
              songNameRef.current = v;
              scheduleSave();
            }}
            placeholder="Song name…"
            className="w-full bg-transparent text-2xl font-bold placeholder-zinc-300 dark:placeholder-zinc-600 outline-none border-b border-transparent focus:border-zinc-200 dark:focus:border-zinc-700 pb-1 transition-colors"
          />
          {/* BPM / Key / Beat type editors */}
          <div className="flex flex-wrap gap-3 items-start">
            {/* BPM */}
            <div className="flex flex-col gap-1 min-w-[140px]">
              <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">BPM</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={40}
                  max={300}
                  value={parseBpmNumber(noteBpm) || ""}
                  onChange={(e) => {
                    const n = parseInt(e.target.value);
                    const v = isNaN(n) ? "" : `${Math.min(300, Math.max(40, n))} BPM`;
                    setNoteBpm(v); noteBpmRef.current = v; scheduleSave();
                  }}
                  onKeyDown={(e) => {
                    const cur = parseBpmNumber(noteBpm) || 120;
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      const v = `${Math.min(300, cur + 1)} BPM`;
                      setNoteBpm(v); noteBpmRef.current = v; scheduleSave();
                    } else if (e.key === "ArrowDown") {
                      e.preventDefault();
                      const v = `${Math.max(40, cur - 1)} BPM`;
                      setNoteBpm(v); noteBpmRef.current = v; scheduleSave();
                    }
                  }}
                  placeholder="—"
                  className="w-16 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-sm text-center outline-none focus:border-red-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <input
                  type="range"
                  min={40}
                  max={300}
                  value={parseBpmNumber(noteBpm) || 120}
                  onChange={(e) => {
                    const v = `${e.target.value} BPM`;
                    setNoteBpm(v); noteBpmRef.current = v; scheduleSave();
                  }}
                  className="w-24 h-1 accent-red-500 cursor-pointer"
                />
              </div>
            </div>
            {/* Key */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Key</span>
              <select
                value={noteKey}
                onChange={(e) => {
                  setNoteKey(e.target.value); noteKeyRef.current = e.target.value; scheduleSave();
                }}
                className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-sm outline-none focus:border-red-400 dark:text-zinc-200"
              >
                <option value="">—</option>
                {MUSICAL_KEYS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
            {/* Beat type */}
            <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
              <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Style</span>
              <input
                list="beat-types-list"
                value={noteBeatType}
                onChange={(e) => {
                  setNoteBeatType(e.target.value); noteBeatTypeRef.current = e.target.value; scheduleSave();
                }}
                placeholder="—"
                className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-sm outline-none focus:border-red-400"
              />
              <datalist id="beat-types-list">
                {BEAT_TYPES.map((bt) => <option key={bt} value={bt} />)}
              </datalist>
            </div>
          </div>
        </div>

        {showTimecodeEditor && (
          <div className="mb-4">
            <TimecodeEditor
              timecodes={timecodes}
              onChange={updateTimecodes}
              onDetect={detectTimecodes}
              detecting={detectingTimecodes}
              beatPlayerRef={beatPlayerRef}
              onClose={() => setShowTimecodeEditor(false)}
            />
          </div>
        )}
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

      {/* Re-analyze confirmation modal */}
      {showReanalyzeConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowReanalyzeConfirm(false)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Re-analyze beat?</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                This will re-fetch metadata from YouTube and overwrite the current BPM, key, beat type, artist references, tags, and timecodes. Your notes and voice recordings won&apos;t be affected.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowReanalyzeConfirm(false)}
                className="px-4 py-1.5 rounded-lg text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowReanalyzeConfirm(false);
                  reanalyze();
                }}
                className="px-4 py-1.5 rounded-lg text-sm font-medium bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-80 transition-opacity"
              >
                Re-analyze
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
