"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";

type Format = "mp3" | "mp4" | "wav";
type Tab = "download" | "search" | "favorites" | "songs";
type AuthMode = "login" | "signup";
type DateFilter = "year" | "6months" | "1month" | "2weeks" | "1week" | "1day";
type ArtistFilter = "Lil Peep" | "Juice WRLD";

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

interface SavedFilters {
  dateFilter: DateFilter | null;
  freeFilter: boolean;
  artistFilter: ArtistFilter | null;
  typeBeat: boolean;
}

interface FavoriteItem extends SearchResult {
  savedFilters: SavedFilters;
}

interface SongItem {
  videoId: string;
  songName: string;
  bpm: string | null;
  key: string | null;
  beatType: string | null;
  videoTitle: string | null;
  videoThumbnail: string | null;
  isPublic: boolean;
  publicId: string | null;
  updatedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────

function extractVideoId(url: string): string | null {
  const match = url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function buildSearchQuery(
  text: string,
  artist: ArtistFilter | null,
  typeBeat: boolean,
  free: boolean
): string {
  let q = text.trim();

  if (artist) {
    q = q ? `${q} ${artist} type beat` : `${artist} type beat`;
  } else if (typeBeat) {
    q = q ? `${q} type beat` : "type beat";
  }

  if (free) q = q ? `${q} free` : "free";

  return q;
}

// ─── Audio Preview Hook ───────────────────────────────────────

function usePreviewPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
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
      if (playingId === id || loadingId === id) { stop(); return; }
      stop();
      setLoadingId(id);

      const abort = new AbortController();
      abortRef.current = abort;

      fetch(`/api/preview?${new URLSearchParams({ url })}`, { signal: abort.signal })
        .then((res) => { if (!res.ok) throw new Error("Preview failed"); return res.blob(); })
        .then((blob) => {
          if (abort.signal.aborted) return;
          const objectUrl = URL.createObjectURL(blob);
          const audio = new Audio(objectUrl);
          audioRef.current = audio;
          audio.addEventListener("ended", () => {
            setPlayingId(null); audioRef.current = null; URL.revokeObjectURL(objectUrl);
          }, { once: true });
          audio.addEventListener("error", () => {
            setLoadingId(null); setPlayingId(null); audioRef.current = null; URL.revokeObjectURL(objectUrl);
          }, { once: true });
          setLoadingId(null);
          setPlayingId(id);
          audio.play().catch(() => {});
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setLoadingId(null); setPlayingId(null);
        });
    },
    [playingId, loadingId, stop]
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
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
          Inspired by{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {analysis.inspiredBy.join(", ")}
          </span>
        </p>
      )}
    </div>
  );
}

// ─── Star Button ──────────────────────────────────────────────

function StarButton({ favorited, onToggle }: { favorited: boolean; onToggle: () => void }) {
  const [burst, setBurst] = useState(false);

  function handleClick() {
    if (!favorited) { setBurst(true); setTimeout(() => setBurst(false), 300); }
    onToggle();
  }

  return (
    <button onClick={handleClick} title={favorited ? "Remove from favorites" : "Add to favorites"} className="flex-shrink-0 focus:outline-none">
      <svg
        viewBox="0 0 24 24"
        className={`transition-all duration-200 ${burst ? "scale-150" : favorited ? "scale-125" : "scale-100"} ${favorited ? "text-yellow-400" : "text-zinc-300 dark:text-zinc-600"}`}
        style={{ width: 20, height: 20 }}
        fill={favorited ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={favorited ? 0 : 1.8}
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </button>
  );
}

// ─── Search Filters ───────────────────────────────────────────

const DATE_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: "year",    label: "Year"   },
  { value: "6months", label: "6M"     },
  { value: "1month",  label: "1M"     },
  { value: "2weeks",  label: "2W"     },
  { value: "1week",   label: "1W"     },
  { value: "1day",    label: "Today"  },
];

const ARTIST_OPTIONS: ArtistFilter[] = ["Lil Peep", "Juice WRLD"];

function FilterPill({
  active,
  onClick,
  children,
  color = "zinc",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: "zinc" | "red" | "green" | "purple";
}) {
  const activeColors: Record<string, string> = {
    zinc:   "bg-zinc-800 text-white border-zinc-800 dark:bg-zinc-200 dark:text-zinc-900 dark:border-zinc-200",
    red:    "bg-red-500 text-white border-red-500",
    green:  "bg-green-500 text-white border-green-500",
    purple: "bg-purple-500 text-white border-purple-500",
  };
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
        active
          ? activeColors[color]
          : "border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-zinc-500"
      }`}
    >
      {children}
    </button>
  );
}

function SearchFilters({
  dateFilter, setDateFilter,
  freeFilter, setFreeFilter,
  artistFilter, setArtistFilter,
  typeBeat, setTypeBeat,
}: {
  dateFilter: DateFilter | null;
  setDateFilter: (v: DateFilter | null) => void;
  freeFilter: boolean;
  setFreeFilter: (v: boolean) => void;
  artistFilter: ArtistFilter | null;
  setArtistFilter: (v: ArtistFilter | null) => void;
  typeBeat: boolean;
  setTypeBeat: (v: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      {/* Row 1: date + free */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 w-10 shrink-0">Date</span>
        {DATE_OPTIONS.map((o) => (
          <FilterPill
            key={o.value}
            active={dateFilter === o.value}
            onClick={() => setDateFilter(dateFilter === o.value ? null : o.value)}
          >
            {o.label}
          </FilterPill>
        ))}
        <div className="ml-auto">
          <FilterPill active={freeFilter} color="green" onClick={() => setFreeFilter(!freeFilter)}>
            Free
          </FilterPill>
        </div>
      </div>

      {/* Row 2: artist presets */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 w-10 shrink-0">Artist</span>
        {ARTIST_OPTIONS.map((a) => (
          <FilterPill
            key={a}
            active={artistFilter === a}
            color="purple"
            onClick={() => setArtistFilter(artistFilter === a ? null : a)}
          >
            {a}
          </FilterPill>
        ))}
        <FilterPill
          active={typeBeat}
          color="red"
          onClick={() => setTypeBeat(!typeBeat)}
        >
          Type beat
        </FilterPill>
      </div>
    </div>
  );
}

// ─── Auth Form ────────────────────────────────────────────────

function AuthForm({ onSuccess, oauthError }: { onSuccess: (user: { id: string; email: string; createdAt: string; hasPassword: boolean }) => void; oauthError?: boolean }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(oauthError ? "Google sign-in failed. Please try again." : "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      const meRes = await fetch("/api/auth/me");
      const meData = await meRes.json();
      if (meData.user) onSuccess(meData.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 space-y-5 dark:border-zinc-700 dark:bg-zinc-800/50">
      <div>
        <h2 className="text-lg font-semibold">
          {mode === "login" ? "Sign in to search" : "Create an account"}
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          {mode === "login"
            ? "You need an account to access YouTube search."
            : "Sign up for free to unlock YouTube search."}
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required
          className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 dark:border-zinc-600 dark:bg-zinc-900" />
        <input type="password" placeholder={mode === "signup" ? "Password (min. 8 characters)" : "Password"}
          value={password} onChange={(e) => setPassword(e.target.value)} required
          className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 dark:border-zinc-600 dark:bg-zinc-900" />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
          {loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
      <div className="relative flex items-center gap-3">
        <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
        <span className="text-xs text-zinc-400">or</span>
        <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
      </div>
      <a href="/api/auth/google"
        className="flex items-center justify-center gap-2.5 w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors">
        <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Continue with Google
      </a>
      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
        {mode === "login" ? (
          <>No account?{" "}<button onClick={() => { setMode("signup"); setError(""); }} className="font-medium text-red-600 hover:underline">Sign up</button></>
        ) : (
          <>Already have an account?{" "}<button onClick={() => { setMode("login"); setError(""); }} className="font-medium text-red-600 hover:underline">Sign in</button></>
        )}
      </p>
    </div>
  );
}

// ─── Result Card ──────────────────────────────────────────────

function ResultCard({
  result, playingId, loadingId, onPlay, onDownload, downloading, favorited, onToggleFavorite, onSearchWithFilters, onNotes,
}: {
  result: SearchResult;
  playingId: string | null;
  loadingId: string | null;
  onPlay: (id: string, url: string) => void;
  onDownload: (id: string) => void;
  downloading: string | null;
  favorited: boolean;
  onToggleFavorite: (result: SearchResult) => void;
  onSearchWithFilters?: () => void;
  onNotes?: () => void;
}) {
  const isPlaying = playingId === result.id;
  const isLoading = loadingId === result.id;
  const isDownloading = downloading === result.id;

  return (
    <div className="flex gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
      <button
        onClick={() => onPlay(result.id, result.url)}
        className="relative flex-shrink-0 h-24 w-36 overflow-hidden rounded-md bg-zinc-200 dark:bg-zinc-700"
      >
        <img src={result.thumbnail} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/55 transition-colors">
          {isLoading ? (
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : isPlaying ? (
            <svg className="h-8 w-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="h-8 w-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </div>
        {result.duration && (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {result.duration}
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col justify-between min-w-0">
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold leading-tight line-clamp-2" title={result.title}>
              {result.title}
            </p>
            <StarButton favorited={favorited} onToggle={() => onToggleFavorite(result)} />
          </div>
          <BeatBadges analysis={result} />
          {result.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {result.tags.slice(0, 4).map((tag, i) => (
                <span key={i} className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => onDownload(result.id)}
            disabled={isDownloading}
            className="self-start rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {isDownloading ? "Downloading..." : "Download WAV"}
          </button>
          {onSearchWithFilters && (
            <button
              onClick={onSearchWithFilters}
              title="Search YouTube with the same filters"
              className="flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200 transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              Find more
            </button>
          )}
          {onNotes && (
            <button
              onClick={onNotes}
              title="Open lyrics & notes"
              className="flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200 transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path d="M12 20h9M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 19.635a2 2 0 0 1-.855.506l-2.872.834a.5.5 0 0 1-.62-.62l.834-2.872a2 2 0 0 1 .506-.854z"/>
              </svg>
              Notes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Form ────────────────────────────────────────────────

function DownloaderForm() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>(
    searchParams.get("tab") === "search" ? "search"
    : searchParams.get("tab") === "favorites" ? "favorites"
    : "download"
  );
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<Format>((searchParams.get("format") as Format) || "mp3");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  // Auth
  const [user, setUser] = useState<{ id: string; email: string; createdAt: string; hasPassword: boolean } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // URL analysis
  const [analysis, setAnalysis] = useState<BeatAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const analyzeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter | null>(null);
  const [freeFilter, setFreeFilter] = useState(false);
  const [artistFilter, setArtistFilter] = useState<ArtistFilter | null>(null);
  const [typeBeat, setTypeBeat] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [downloadingResult, setDownloadingResult] = useState<string | null>(null);

  // Favorites
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [downloadingFav, setDownloadingFav] = useState<string | null>(null);

  // Songs
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [songsLoading, setSongsLoading] = useState(false);

  const { playingId, loadingId, play, stop } = usePreviewPlayer();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => setUser(data.user ?? null))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!user) { setFavoriteIds(new Set()); setFavorites([]); return; }
    fetch("/api/favorites")
      .then((r) => r.json())
      .then((data) => {
        const favs: FavoriteItem[] = (data.favorites ?? []).map((f: {
          videoId: string; title: string; thumbnail: string;
          duration: string; durationSec: number; url: string;
          bpm: string | null; key: string | null; beatType: string | null;
          inspiredBy: string[]; tags: string[];
          dateFilter: string | null; freeFilter: boolean;
          artistFilter: string | null; typeBeat: boolean;
        }) => ({
          id: f.videoId, title: f.title, thumbnail: f.thumbnail,
          duration: f.duration, durationSec: f.durationSec, url: f.url,
          bpm: f.bpm, key: f.key, beatType: f.beatType,
          inspiredBy: f.inspiredBy, tags: f.tags,
          savedFilters: {
            dateFilter: (f.dateFilter as DateFilter | null),
            freeFilter: f.freeFilter,
            artistFilter: (f.artistFilter as ArtistFilter | null),
            typeBeat: f.typeBeat,
          },
        }));
        setFavorites(favs);
        setFavoriteIds(new Set(favs.map((f) => f.id)));
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (tab === "download") params.set("format", format);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [tab, format, router]);

  useEffect(() => {
    if (analyzeTimer.current) clearTimeout(analyzeTimer.current);
    setAnalysis(null);
    const isYouTube = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/.test(url.trim());
    if (!isYouTube) return;
    analyzeTimer.current = setTimeout(() => analyzeUrl(url.trim()), 500);
    return () => { if (analyzeTimer.current) clearTimeout(analyzeTimer.current); };
  }, [url]);

  async function analyzeUrl(videoUrl: string) {
    setAnalyzing(true); setError("");
    try {
      const res = await fetch(`/api/analyze?${new URLSearchParams({ url: videoUrl })}`);
      if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error || "Analysis failed"); }
      setAnalysis(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally { setAnalyzing(false); }
  }

  async function handleDownload() {
    if (!url.trim()) { setError("Please paste a YouTube URL"); return; }
    setError(""); setDownloading(true);
    try {
      const res = await fetch(`/api/download?${new URLSearchParams({ url, format })}`);
      if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error || `Download failed (${res.status})`); }
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="(.+)"/);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = match ? match[1] : `video.${format}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally { setDownloading(false); }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = buildSearchQuery(searchQuery, artistFilter, typeBeat, freeFilter);
    if (!q) return;
    stop(); setSearching(true); setError(""); setResults([]);
    try {
      const params = new URLSearchParams({ q });
      if (dateFilter) params.set("dateFilter", dateFilter);
      const res = await fetch(`/api/search?${params}`);
      if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error || "Search failed"); }
      const data = await res.json();
      setResults(data.results || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally { setSearching(false); }
  }

  async function downloadBlob(url: string, fallbackName: string) {
    const res = await fetch(`/api/download?${new URLSearchParams({ url, format: "wav" })}`);
    if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error || "Download failed"); }
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="(.+)"/);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = match ? match[1] : fallbackName;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  }

  async function handleDownloadResult(id: string) {
    const result = results.find((r) => r.id === id);
    if (!result) return;
    setDownloadingResult(id);
    try { await downloadBlob(result.url, `${result.title}.wav`); }
    catch (e) { setError(e instanceof Error ? e.message : "Download failed"); }
    finally { setDownloadingResult(null); }
  }

  async function handleDownloadFavorite(id: string) {
    const result = favorites.find((r) => r.id === id);
    if (!result) return;
    setDownloadingFav(id);
    try { await downloadBlob(result.url, `${result.title}.wav`); }
    catch (e) { setError(e instanceof Error ? e.message : "Download failed"); }
    finally { setDownloadingFav(null); }
  }

  async function handleToggleFavorite(result: SearchResult, filters?: SavedFilters) {
    if (!user) return;
    const isFav = favoriteIds.has(result.id);
    const savedFilters: SavedFilters = filters ?? {
      dateFilter, freeFilter, artistFilter, typeBeat,
    };
    const favItem: FavoriteItem = { ...result, savedFilters };
    if (isFav) {
      setFavoriteIds((p) => { const s = new Set(p); s.delete(result.id); return s; });
      setFavorites((p) => p.filter((f) => f.id !== result.id));
    } else {
      setFavoriteIds((p) => new Set(p).add(result.id));
      setFavorites((p) => [favItem, ...p]);
    }
    try {
      if (isFav) {
        await fetch(`/api/favorites?videoId=${result.id}`, { method: "DELETE" });
      } else {
        await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            videoId: result.id, title: result.title, thumbnail: result.thumbnail,
            duration: result.duration, durationSec: result.durationSec, url: result.url,
            bpm: result.bpm, key: result.key, beatType: result.beatType,
            inspiredBy: result.inspiredBy, tags: result.tags,
            dateFilter: savedFilters.dateFilter,
            freeFilter: savedFilters.freeFilter,
            artistFilter: savedFilters.artistFilter,
            typeBeat: savedFilters.typeBeat,
          }),
        });
      }
    } catch {
      if (isFav) {
        setFavoriteIds((p) => new Set(p).add(result.id));
        setFavorites((p) => [favItem, ...p]);
      } else {
        setFavoriteIds((p) => { const s = new Set(p); s.delete(result.id); return s; });
        setFavorites((p) => p.filter((f) => f.id !== result.id));
      }
    }
  }

  useEffect(() => {
    if (tab !== "songs" || !user) return;
    setSongsLoading(true);
    fetch("/api/songs")
      .then((r) => r.json())
      .then((data) => setSongs(data.songs ?? []))
      .finally(() => setSongsLoading(false));
  }, [tab, user]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null); setResults([]); setFavorites([]); setFavoriteIds(new Set()); setSongs([]);
    stop();
    if (tab === "favorites" || tab === "songs") setTab("download");
  }

  const formats: { value: Format; label: string }[] = [
    { value: "mp4", label: "MP4" },
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV" },
  ];

  const hasActiveFilters = !!(dateFilter || freeFilter || artistFilter || typeBeat);

  return (
    <div className="flex flex-col items-center flex-1 px-4 py-8">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Music Craftbook</h1>
          {!authLoading && user && (
            <div className="flex items-center gap-3">
              <Link href="/settings" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
                Settings
              </Link>
              <button onClick={handleLogout} className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
                Sign out
              </button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden">
          {(["download", "search"] as Tab[]).map((t) => (
            <button key={t} onClick={() => { setTab(t); setError(""); }}
              className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${tab === t ? "bg-red-500 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
              {t === "download" ? "Paste URL" : "Search YouTube"}
            </button>
          ))}
          {user && (
            <button onClick={() => { setTab("favorites"); setError(""); }}
              className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${tab === "favorites" ? "bg-red-500 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
              <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 ${tab === "favorites" ? "text-yellow-300" : "text-yellow-400"}`} fill="currentColor">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              Favorites
              {favoriteIds.size > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${tab === "favorites" ? "bg-white/20 text-white" : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400"}`}>
                  {favoriteIds.size}
                </span>
              )}
            </button>
          )}
          {user && (
            <button onClick={() => { setTab("songs"); setError(""); }}
              className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${tab === "songs" ? "bg-red-500 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
              </svg>
              Songs
              {songs.length > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${tab === "songs" ? "bg-white/20 text-white" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"}`}>
                  {songs.length}
                </span>
              )}
            </button>
          )}
        </div>

        {/* ── Download Tab ── */}
        {tab === "download" && (
          <>
            {/* Format selector — download tab only */}
            <div className="flex gap-2">
              {formats.map((f) => (
                <button key={f.value} onClick={() => setFormat(f.value)}
                  className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${format === f.value ? "border-red-500 bg-red-500 text-white" : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"}`}>
                  {f.label}
                </button>
              ))}
            </div>

            <input type="text" placeholder="Paste YouTube URL here..." value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 dark:border-zinc-700 dark:bg-zinc-900" />

            {analyzing && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-red-500" />
                  Scanning video info...
                </div>
              </div>
            )}

            {analysis && !analyzing && (() => {
              const videoId = extractVideoId(url.trim());
              const asResult: SearchResult | null = videoId ? {
                id: videoId, url: url.trim(), title: analysis.title,
                thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                duration: "", durationSec: 0,
                bpm: analysis.bpm, key: analysis.key, beatType: analysis.beatType,
                inspiredBy: analysis.inspiredBy, tags: analysis.tags,
              } : null;
              return (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 space-y-3 dark:border-zinc-700 dark:bg-zinc-800/50">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-sm truncate" title={analysis.title}>{analysis.title}</p>
                    {user && asResult && <StarButton favorited={favoriteIds.has(asResult.id)} onToggle={() => handleToggleFavorite(asResult)} />}
                  </div>
                  <BeatBadges analysis={analysis} />
                  {analysis.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.tags.map((tag, i) => (
                        <span key={i} className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400">{tag}</span>
                      ))}
                    </div>
                  )}
                  {!analysis.bpm && !analysis.key && !analysis.beatType && analysis.inspiredBy.length === 0 && (
                    <p className="text-xs text-zinc-400">No beat details found in the video metadata.</p>
                  )}
                </div>
              );
            })()}

            <button onClick={handleDownload} disabled={downloading}
              className="w-full rounded-lg bg-red-600 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {downloading ? "Downloading..." : "Download"}
            </button>
          </>
        )}

        {/* ── Search Tab ── */}
        {tab === "search" && (
          <>
            {authLoading ? (
              <div className="flex justify-center py-12">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-red-500" />
              </div>
            ) : !user ? (
              <AuthForm onSuccess={setUser} oauthError={searchParams.get("error") === "oauth_failed"} />
            ) : (
              <>
                <SearchFilters
                  dateFilter={dateFilter} setDateFilter={setDateFilter}
                  freeFilter={freeFilter} setFreeFilter={setFreeFilter}
                  artistFilter={artistFilter} setArtistFilter={setArtistFilter}
                  typeBeat={typeBeat} setTypeBeat={setTypeBeat}
                />

                <form onSubmit={handleSearch} className="flex gap-2">
                  <input type="text" placeholder={
                    artistFilter ? `${artistFilter} type beat…`
                    : typeBeat ? "type beat…"
                    : "Search beats, instrumentals, songs…"
                  }
                    value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 dark:border-zinc-700 dark:bg-zinc-900" />
                  <button type="submit" disabled={searching || (!searchQuery.trim() && !artistFilter && !typeBeat && !freeFilter)}
                    className="rounded-lg bg-red-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50">
                    {searching
                      ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      : "Search"}
                  </button>
                </form>

                {hasActiveFilters && (
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <span>Searching for:</span>
                    <span className="font-medium text-zinc-600 dark:text-zinc-300 italic">
                      &ldquo;{buildSearchQuery(searchQuery, artistFilter, typeBeat, freeFilter) || "…"}&rdquo;
                    </span>
                    {dateFilter && <span className="text-zinc-400">· filtered by date</span>}
                  </div>
                )}

                {searching && results.length === 0 && (
                  <div className="flex items-center justify-center py-12">
                    <div className="flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-red-500" />
                      Searching and analyzing results…
                    </div>
                  </div>
                )}

                {results.length > 0 && (
                  <div className="space-y-3">
                    {results.map((result) => (
                      <ResultCard key={result.id} result={result} playingId={playingId} loadingId={loadingId}
                        onPlay={play} onDownload={handleDownloadResult} downloading={downloadingResult}
                        favorited={favoriteIds.has(result.id)} onToggleFavorite={handleToggleFavorite} />
                    ))}
                  </div>
                )}

                {!searching && results.length === 0 && (searchQuery || hasActiveFilters) && (
                  <p className="text-center text-sm text-zinc-400 py-8">No results. Try a different search.</p>
                )}
              </>
            )}
          </>
        )}

        {/* ── Favorites Tab ── */}
        {tab === "favorites" && user && (
          favorites.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-zinc-400">
              <svg viewBox="0 0 24 24" className="w-12 h-12 text-zinc-200 dark:text-zinc-700" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              <p className="text-sm">No favorites yet.</p>
              <p className="text-xs">Search for videos and tap the star to save them here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {favorites.map((result) => (
                <ResultCard
                  key={result.id}
                  result={result}
                  playingId={playingId}
                  loadingId={loadingId}
                  onPlay={play}
                  onDownload={handleDownloadFavorite}
                  downloading={downloadingFav}
                  favorited={true}
                  onToggleFavorite={(r) => handleToggleFavorite(r, result.savedFilters)}
                  onNotes={() => router.push(`/notes/${result.id}`)}
                  onSearchWithFilters={() => {
                    const sf = result.savedFilters;
                    setDateFilter(sf.dateFilter);
                    setFreeFilter(sf.freeFilter);
                    setArtistFilter(sf.artistFilter);
                    setTypeBeat(sf.typeBeat);
                    setSearchQuery("");
                    setResults([]);
                    setTab("search");
                  }}
                />
              ))}
            </div>
          )
        )}

        {/* ── Songs Tab ── */}
        {tab === "songs" && user && (
          songsLoading ? (
            <div className="flex justify-center py-12">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-red-500" />
            </div>
          ) : songs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-zinc-400">
              <svg viewBox="0 0 24 24" className="w-12 h-12 text-zinc-200 dark:text-zinc-700" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
              </svg>
              <p className="text-sm">No songs yet.</p>
              <p className="text-xs">Open a note and add a song name to see it here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {songs.map((song) => (
                <div key={song.videoId} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 flex items-start gap-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                  {song.videoThumbnail && (
                    <img src={song.videoThumbnail} alt="" className="flex-shrink-0 h-14 w-20 rounded-lg object-cover" />
                  )}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm leading-tight truncate">{song.songName}</p>
                        {song.videoTitle && (
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{song.videoTitle}</p>
                        )}
                      </div>
                      <span className={`flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${song.isPublic ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"}`}>
                        {song.isPublic ? "Public" : "Private"}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {song.beatType && (
                        <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">{song.beatType}</span>
                      )}
                      {song.bpm && (
                        <span className="rounded-md bg-zinc-200 px-2 py-0.5 text-xs font-medium dark:bg-zinc-700">{song.bpm}</span>
                      )}
                      {song.key && (
                        <span className="rounded-md bg-zinc-200 px-2 py-0.5 text-xs font-medium dark:bg-zinc-700">{song.key}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => router.push(`/notes/${song.videoId}`)}
                        className="text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
                      >
                        Open notes →
                      </button>
                      {song.isPublic && song.publicId && (
                        <button
                          onClick={() => navigator.clipboard.writeText(`${window.location.origin}/view/${song.publicId}`)}
                          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                        >
                          Copy share link
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
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
