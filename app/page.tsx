"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";

type Format = "mp3" | "mp4" | "wav";
type Tab = "download" | "search";

interface BeatAnalysis {
  title: string;
  bpm: string | null;
  key: string | null;
  beatType: string | null;
  inspiredBy: string[];
  tags: string[];
}

interface SearchResult extends BeatAnalysis {
  id: string;
  url: string;
  duration: string;
  durationSec: number;
  thumbnail: string;
}

// ─── Audio Preview Hook ───────────────────────────────────────

function usePreviewPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const stop = useCallback(() => {
    // Abort any in-flight fetch
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // Stop any playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setPlayingId(null);
    setLoadingId(null);
  }, []);

  const play = useCallback(
    (id: string, url: string) => {
      if (playingId === id || loadingId === id) {
        stop();
        return;
      }

      stop();
      setLoadingId(id);

      const abort = new AbortController();
      abortRef.current = abort;

      const params = new URLSearchParams({ url });
      fetch(`/api/preview?${params.toString()}`, { signal: abort.signal })
        .then((res) => {
          if (!res.ok) throw new Error("Preview failed");
          return res.blob();
        })
        .then((blob) => {
          if (abort.signal.aborted) return;

          const objectUrl = URL.createObjectURL(blob);
          const audio = new Audio(objectUrl);
          audioRef.current = audio;

          audio.addEventListener("ended", () => {
            setPlayingId(null);
            audioRef.current = null;
            URL.revokeObjectURL(objectUrl);
          }, { once: true });

          audio.addEventListener("error", () => {
            setLoadingId(null);
            setPlayingId(null);
            audioRef.current = null;
            URL.revokeObjectURL(objectUrl);
          }, { once: true });

          setLoadingId(null);
          setPlayingId(id);
          audio.play().catch(() => {});
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setLoadingId(null);
          setPlayingId(null);
        });
    },
    [playingId, loadingId, stop]
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, []);

  return { playingId, loadingId, play, stop };
}

// ─── Beat Info Badges ─────────────────────────────────────────

function BeatBadges({ analysis }: { analysis: BeatAnalysis }) {
  const hasBeatInfo =
    analysis.beatType || analysis.bpm || analysis.key || analysis.inspiredBy.length > 0;

  if (!hasBeatInfo) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {analysis.beatType && (
          <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
            {analysis.beatType}
          </span>
        )}
        {analysis.bpm && (
          <span className="rounded-md bg-zinc-200 px-2 py-0.5 text-xs font-medium dark:bg-zinc-700">
            {analysis.bpm}
          </span>
        )}
        {analysis.key && (
          <span className="rounded-md bg-zinc-200 px-2 py-0.5 text-xs font-medium dark:bg-zinc-700">
            {analysis.key}
          </span>
        )}
      </div>
      {analysis.inspiredBy.length > 0 && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Inspired by <span className="font-medium text-zinc-700 dark:text-zinc-300">{analysis.inspiredBy.join(", ")}</span>
        </p>
      )}
    </div>
  );
}

// ─── Search Result Card ───────────────────────────────────────

function ResultCard({
  result,
  playingId,
  loadingId,
  onPlay,
  onDownload,
  downloading,
}: {
  result: SearchResult;
  playingId: string | null;
  loadingId: string | null;
  onPlay: (id: string, url: string) => void;
  onDownload: (url: string) => void;
  downloading: string | null;
}) {
  const isPlaying = playingId === result.id;
  const isLoading = loadingId === result.id;
  const isDownloading = downloading === result.id;

  return (
    <div className="flex gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
      {/* Thumbnail + Play overlay */}
      <button
        onClick={() => onPlay(result.id, result.url)}
        className="relative flex-shrink-0 h-24 w-36 overflow-hidden rounded-md bg-zinc-200 dark:bg-zinc-700"
      >
        <img
          src={result.thumbnail}
          alt=""
          className="h-full w-full object-cover"
        />
        {/* Play / Pause / Loading overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity hover:bg-black/50">
          {isLoading ? (
            <span className="h-8 w-8 animate-spin rounded-full border-3 border-white/40 border-t-white" />
          ) : isPlaying ? (
            <svg className="h-8 w-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="h-8 w-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </div>
        {/* Duration badge */}
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {result.duration}
        </span>
      </button>

      {/* Info */}
      <div className="flex flex-1 flex-col justify-between min-w-0">
        <div className="space-y-1.5">
          <p className="text-sm font-semibold leading-tight line-clamp-2" title={result.title}>
            {result.title}
          </p>
          <BeatBadges analysis={result} />
          {result.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {result.tags.slice(0, 4).map((tag, i) => (
                <span
                  key={i}
                  className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => onDownload(result.id)}
          disabled={isDownloading}
          className="mt-2 self-start rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          {isDownloading ? "Downloading..." : "Download"}
        </button>
      </div>
    </div>
  );
}

// ─── Main Form ────────────────────────────────────────────────

function DownloaderForm() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>(
    searchParams.get("tab") === "search" ? "search" : "download"
  );
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<Format>(
    (searchParams.get("format") as Format) || "mp3"
  );
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  // Single URL analysis
  const [analysis, setAnalysis] = useState<BeatAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const analyzeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [downloadingResult, setDownloadingResult] = useState<string | null>(null);

  // Preview player
  const { playingId, loadingId, play, stop } = usePreviewPlayer();

  // Sync tab + format to URL
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    params.set("format", format);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [tab, format, router]);

  // Auto-analyze when a valid YouTube URL is detected
  useEffect(() => {
    if (analyzeTimer.current) clearTimeout(analyzeTimer.current);
    setAnalysis(null);

    const isYouTube =
      /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/.test(
        url.trim()
      );

    if (!isYouTube) return;

    analyzeTimer.current = setTimeout(() => {
      analyzeUrl(url.trim());
    }, 500);

    return () => {
      if (analyzeTimer.current) clearTimeout(analyzeTimer.current);
    };
  }, [url]);

  async function analyzeUrl(videoUrl: string) {
    setAnalyzing(true);
    setError("");
    try {
      const params = new URLSearchParams({ url: videoUrl });
      const res = await fetch(`/api/analyze?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Analysis failed");
      }
      const data: BeatAnalysis = await res.json();
      setAnalysis(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleDownload() {
    if (!url.trim()) {
      setError("Please paste a YouTube URL");
      return;
    }
    setError("");
    setDownloading(true);
    try {
      const params = new URLSearchParams({ url, format });
      const res = await fetch(`/api/download?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Download failed (${res.status})`);
      }
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="(.+)"/);
      const filename = match ? match[1] : `video.${format}`;
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    stop();
    setSearching(true);
    setError("");
    setResults([]);
    try {
      const params = new URLSearchParams({ q: searchQuery });
      const res = await fetch(`/api/search?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Search failed");
      }
      const data = await res.json();
      setResults(data.results || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function handleDownloadResult(id: string) {
    const result = results.find((r) => r.id === id);
    if (!result) return;
    setDownloadingResult(id);
    try {
      const params = new URLSearchParams({ url: result.url, format });
      const res = await fetch(`/api/download?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Download failed");
      }
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="(.+)"/);
      const filename = match ? match[1] : `${result.title}.${format}`;
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloadingResult(null);
    }
  }

  const formats: { value: Format; label: string }[] = [
    { value: "mp4", label: "MP4" },
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV" },
  ];

  return (
    <div className="flex flex-col items-center flex-1 px-4 py-8">
      <div className="w-full max-w-2xl space-y-6">
        <h1 className="text-3xl font-bold text-center">YouTube Downloader</h1>

        {/* Tab switcher */}
        <div className="flex rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden">
          <button
            onClick={() => setTab("download")}
            className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === "download"
                ? "bg-red-500 text-white"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            Paste URL
          </button>
          <button
            onClick={() => setTab("search")}
            className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === "search"
                ? "bg-red-500 text-white"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            Search YouTube
          </button>
        </div>

        {/* Format selector (shared) */}
        <div className="flex gap-2">
          {formats.map((f) => (
            <button
              key={f.value}
              onClick={() => setFormat(f.value)}
              className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                format === f.value
                  ? "border-red-500 bg-red-500 text-white"
                  : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* ── Download Tab ── */}
        {tab === "download" && (
          <>
            <input
              type="text"
              placeholder="Paste YouTube URL here..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 dark:border-zinc-700 dark:bg-zinc-900"
            />

            {analyzing && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-red-500" />
                  Scanning video info...
                </div>
              </div>
            )}

            {analysis && !analyzing && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 space-y-3 dark:border-zinc-700 dark:bg-zinc-800/50">
                <p className="font-semibold text-sm truncate" title={analysis.title}>
                  {analysis.title}
                </p>
                <BeatBadges analysis={analysis} />
                {analysis.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.tags.map((tag, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {!analysis.bpm &&
                  !analysis.key &&
                  !analysis.beatType &&
                  analysis.inspiredBy.length === 0 && (
                    <p className="text-xs text-zinc-400">
                      No beat details found in the video metadata.
                    </p>
                  )}
              </div>
            )}

            <button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full rounded-lg bg-red-600 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {downloading ? "Downloading..." : "Download"}
            </button>
          </>
        )}

        {/* ── Search Tab ── */}
        {tab === "search" && (
          <>
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="text"
                placeholder="Search beats, instrumentals, songs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                type="submit"
                disabled={searching}
                className="rounded-lg bg-red-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {searching ? (
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  "Search"
                )}
              </button>
            </form>

            {searching && results.length === 0 && (
              <div className="flex items-center justify-center py-12">
                <div className="flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-red-500" />
                  Searching and analyzing results...
                </div>
              </div>
            )}

            {results.length > 0 && (
              <div className="space-y-3">
                {results.map((result) => (
                  <ResultCard
                    key={result.id}
                    result={result}
                    playingId={playingId}
                    loadingId={loadingId}
                    onPlay={play}
                    onDownload={handleDownloadResult}
                    downloading={downloadingResult}
                  />
                ))}
              </div>
            )}

            {!searching && results.length === 0 && searchQuery && (
              <p className="text-center text-sm text-zinc-400 py-8">
                No results. Try a different search.
              </p>
            )}
          </>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense>
      <DownloaderForm />
    </Suspense>
  );
}
