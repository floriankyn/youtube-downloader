"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";

interface TextBlock { id: string; type: "text"; content: string; }
interface VoiceBlock {
  id: string; type: "voice";
  audioBase64: string; mimeType: string;
  duration: number; createdAt: string;
  beatTimecode: number | null; sectionTag: string | null;
}
type Block = TextBlock | VoiceBlock;

interface NoteData {
  videoId: string;
  songName: string | null;
  bpm: string | null;
  key: string | null;
  beatType: string | null;
  videoTitle: string | null;
  videoThumbnail: string | null;
  videoUrl: string | null;
  blocks: Block[];
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function VoicePlayer({ block }: { block: VoiceBlock }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const src = `data:${block.mimeType};base64,${block.audioBase64}`;

  function toggle() {
    if (!audioRef.current) {
      const audio = new Audio(src);
      audioRef.current = audio;
      audio.addEventListener("timeupdate", () => {
        const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : block.duration;
        setProgress(dur > 0 ? audio.currentTime / dur : 0);
      });
      audio.addEventListener("ended", () => { setPlaying(false); setProgress(0); audioRef.current = null; });
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  }

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  return (
    <div className="flex items-center gap-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 px-4 py-3">
      <button
        onClick={toggle}
        className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
      >
        {playing ? (
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        )}
      </button>
      <div className="flex-1 space-y-1">
        <div className="h-1 rounded-full bg-zinc-300 dark:bg-zinc-600 overflow-hidden">
          <div className="h-full bg-zinc-700 dark:bg-zinc-300 rounded-full transition-all" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="flex items-center gap-2">
          {block.sectionTag && (
            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
              {block.sectionTag}
            </span>
          )}
          {block.beatTimecode !== null && (
            <span className="text-[10px] text-zinc-400">@ {formatTime(block.beatTimecode)}</span>
          )}
          <span className="text-[10px] text-zinc-400">{formatTime(block.duration)}</span>
        </div>
      </div>
    </div>
  );
}

export default function ViewPage() {
  const { publicId } = useParams<{ publicId: string }>();
  const [note, setNote] = useState<NoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/view/${publicId}`)
      .then((r) => {
        if (!r.ok) { setNotFound(true); return null; }
        return r.json();
      })
      .then((data) => { if (data) setNote(data.note); })
      .finally(() => setLoading(false));
  }, [publicId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-red-500" />
      </div>
    );
  }

  if (notFound || !note) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-zinc-400">
        <svg viewBox="0 0 24 24" className="w-12 h-12 text-zinc-200 dark:text-zinc-700" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <circle cx="12" cy="12" r="10" /><path d="M9 9l6 6M15 9l-6 6" />
        </svg>
        <p className="text-sm">This song isn&apos;t available.</p>
        <p className="text-xs">It may have been made private or the link is incorrect.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      {/* Header */}
      <div className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-2xl px-4 py-6 space-y-3">
          <div className="flex items-start gap-4">
            {note.videoThumbnail && (
              <img src={note.videoThumbnail} alt="" className="flex-shrink-0 h-16 w-24 rounded-lg object-cover" />
            )}
            <div className="flex-1 min-w-0 space-y-1">
              {note.songName && (
                <h1 className="text-2xl font-bold truncate">{note.songName}</h1>
              )}
              {note.videoTitle && (
                <p className={`truncate ${note.songName ? "text-sm text-zinc-500 dark:text-zinc-400" : "text-xl font-semibold"}`}>
                  {note.videoTitle}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {note.beatType && (
                  <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    {note.beatType}
                  </span>
                )}
                {note.bpm && (
                  <span className="rounded-md bg-zinc-200 px-2 py-0.5 text-xs font-medium dark:bg-zinc-700">
                    {note.bpm}
                  </span>
                )}
                {note.key && (
                  <span className="rounded-md bg-zinc-200 px-2 py-0.5 text-xs font-medium dark:bg-zinc-700">
                    {note.key}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span>Shared via Music Craftbook</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-4">
        {note.blocks.map((block) => {
          if (block.type === "text") {
            if (!block.content.trim()) return null;
            return (
              <div key={block.id} className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                {block.content}
              </div>
            );
          }
          return <VoicePlayer key={block.id} block={block} />;
        })}
      </div>
    </div>
  );
}
