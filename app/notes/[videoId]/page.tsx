"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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

function useRecorder(onDone: (base64: string, mimeType: string, duration: number) => void) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone; // keep fresh every render, no effect needed

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

function VoicePlayer({ block, onDelete }: { block: VoiceBlock; onDelete: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const src = `data:${block.mimeType};base64,${block.audioBase64}`;

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    playing ? audio.pause() : audio.play();
  }

  return (
    <div className="flex items-center gap-3 rounded-xl bg-zinc-100 px-4 py-3 dark:bg-zinc-800 group">
      <audio
        ref={audioRef}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0); }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (a.duration) setProgress(a.currentTime / a.duration);
        }}
      />
      <button
        onClick={toggle}
        className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors"
      >
        {playing ? (
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
        <div className="flex justify-between text-[10px] text-zinc-400">
          <span>Voice note</span>
          <span>{formatDuration(block.duration)}</span>
        </div>
      </div>
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
  );
}

// ─── Insert Voice Note Button ─────────────────────────────────

function InsertBar({
  index, recording, elapsed, activeIndex, onStartRecord, onStopRecord, onInsertSection,
}: {
  index: number;
  recording: boolean;
  elapsed: number;
  activeIndex: number | null;
  onStartRecord: (index: number) => void;
  onStopRecord: () => void;
  onInsertSection: (index: number) => void;
}) {
  const isActive = activeIndex === index;

  return (
    <div className="flex items-center gap-2 py-1 group">
      <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-800 group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700 transition-colors" />
      {isActive && recording ? (
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
      ) : (
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
            title="Record a voice note here"
          >
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="9" y="2" width="6" height="11" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0M12 19v3M9 22h6" />
            </svg>
            Voice note
          </button>
        </div>
      )}
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

function BeatPlayer({ url, title }: { url: string; title: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [downloading, setDownloading] = useState(false);

  // Lazy-load: only fetch when user first presses play
  async function load() {
    setStatus("loading");
    try {
      const res = await fetch(`/api/preview?${new URLSearchParams({ url })}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      setBlobUrl(obj);
      setStatus("ready");
      return obj;
    } catch {
      setStatus("idle");
    }
  }

  async function togglePlay() {
    let src = blobUrl;
    if (status === "idle") src = await load() ?? null;
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

  const [favorite, setFavorite] = useState<Favorite | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([{ id: nanoid(), type: "text", content: "" }]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [activeRecordIndex, setActiveRecordIndex] = useState<number | null>(null);

  // Ref so the recorder callback always reads the current index, never stale
  const activeRecordIndexRef = useRef<number | null>(null);
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

  function insertVoiceBlock(atIndex: number, audioBase64: string, mimeType: string, duration: number) {
    const voiceBlock: VoiceBlock = {
      id: nanoid(), type: "voice", audioBase64, mimeType, duration,
      createdAt: new Date().toISOString(),
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
      insertVoiceBlock(idx, base64, mimeType, duration);
    }
  });

  function handleStartRecord(index: number) {
    activeRecordIndexRef.current = index; // set ref first, synchronously
    setActiveRecordIndex(index);
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
          </div>
          {/* Row 2: beat player */}
          <BeatPlayer url={favorite.url} title={favorite.title} />
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
            />
            {block.type === "text" ? (
              <AutoTextarea
                value={block.content}
                onChange={(v) => updateTextBlock(block.id, v)}
                onDelete={blocks.length > 1 ? () => deleteBlock(block.id) : undefined}
                placeholder={i === 0 ? "Write your lyrics here…" : "Continue writing…"}
              />
            ) : (
              <VoicePlayer block={block} onDelete={() => deleteBlock(block.id)} />
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
        />
      </div>
    </div>
  );
}
