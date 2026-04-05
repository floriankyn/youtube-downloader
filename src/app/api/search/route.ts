import { type NextRequest } from "next/server";
import { execFileAsync, getYtDlpPath, analyzeBeatInfo } from "@/app/lib/ytdlp";
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/prisma";
import {
  YT_API_BASE,
  parseIsoDuration,
  formatYtDuration,
  toUploadDate,
  parseYouTubeError,
} from "@/app/lib/youtube";

export const maxDuration = 60;

const PAGE_SIZE = 15;
const MAX_PAGE = 4; // yt-dlp only

// ── Date helpers ────────────────────────────────────────────────

/** YouTube API: RFC 3339 */
function computePublishedAfter(filter: string): string {
  const d = new Date();
  switch (filter) {
    case "year":    d.setFullYear(d.getFullYear() - 1); break;
    case "6months": d.setMonth(d.getMonth() - 6); break;
    case "1month":  d.setMonth(d.getMonth() - 1); break;
    case "2weeks":  d.setDate(d.getDate() - 14); break;
    case "1week":   d.setDate(d.getDate() - 7); break;
    case "1day":    d.setDate(d.getDate() - 1); break;
  }
  return d.toISOString();
}

/** yt-dlp: YYYYMMDD */
function computeDateAfter(filter: string): string {
  const d = new Date();
  switch (filter) {
    case "year":    d.setFullYear(d.getFullYear() - 1); break;
    case "6months": d.setMonth(d.getMonth() - 6); break;
    case "1month":  d.setMonth(d.getMonth() - 1); break;
    case "2weeks":  d.setDate(d.getDate() - 14); break;
    case "1week":   d.setDate(d.getDate() - 7); break;
    case "1day":    d.setDate(d.getDate() - 1); break;
  }
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Cache helper ────────────────────────────────────────────────

function persistToCache(results: {
  id: string; title: string; thumbnail: string; duration: string;
  durationSec: number; url: string; viewCount: number | null;
  uploader: string | null; uploadDate: string | null;
}[]) {
  void Promise.all(
    results.map((r) =>
      prisma.cachedVideo.upsert({
        where: { videoId: r.id },
        update: {
          title: r.title, thumbnail: r.thumbnail, duration: r.duration,
          durationSec: r.durationSec, url: r.url, viewCount: r.viewCount ?? null,
          uploader: r.uploader ?? null, uploadDate: r.uploadDate ?? null,
        },
        create: {
          videoId: r.id, title: r.title, thumbnail: r.thumbnail, duration: r.duration,
          durationSec: r.durationSec, url: r.url, viewCount: r.viewCount ?? null,
          uploader: r.uploader ?? null, uploadDate: r.uploadDate ?? null,
        },
      })
    )
  );
}

// ── Main handler ────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { youtubeApiKey: true },
  });

  const query = request.nextUrl.searchParams.get("q");
  const dateFilter = request.nextUrl.searchParams.get("dateFilter");
  const pageToken = request.nextUrl.searchParams.get("pageToken");

  if (!query?.trim()) {
    return Response.json({ error: "Missing search query" }, { status: 400 });
  }

  return dbUser?.youtubeApiKey
    ? youtubeApiSearch(query.trim(), dateFilter, pageToken, dbUser.youtubeApiKey)
    : ytDlpSearch(query.trim(), dateFilter, pageToken);
}

// ── Mode A: YouTube Data API v3 ─────────────────────────────────

async function youtubeApiSearch(
  query: string,
  dateFilter: string | null,
  pageToken: string | null,
  apiKey: string
) {
  try {
    const searchParams = new URLSearchParams({
      part: "snippet",
      type: "video",
      q: query,
      maxResults: String(PAGE_SIZE),
      key: apiKey,
    });
    if (pageToken) searchParams.set("pageToken", pageToken);
    if (dateFilter) searchParams.set("publishedAfter", computePublishedAfter(dateFilter));

    const searchRes = await fetch(`${YT_API_BASE}/search?${searchParams}`);
    if (!searchRes.ok) {
      const body = await searchRes.json().catch(() => null);
      const err = parseYouTubeError(searchRes.status, body);
      return Response.json({ error: err.message, code: err.code }, { status: err.httpStatus });
    }
    const searchData = await searchRes.json();

    type SearchItem = {
      id: { videoId: string };
      snippet: { thumbnails: { high?: { url: string }; medium?: { url: string } } };
    };
    const items: SearchItem[] = searchData.items ?? [];
    const nextPageToken: string | undefined = searchData.nextPageToken;

    if (items.length === 0) {
      return Response.json({ results: [], nextPageToken: null, hasMore: false });
    }

    const videoIds = items.map((i) => i.id.videoId).join(",");
    const videosRes = await fetch(
      `${YT_API_BASE}/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${apiKey}`
    );
    if (!videosRes.ok) {
      const body = await videosRes.json().catch(() => null);
      const err = parseYouTubeError(videosRes.status, body);
      return Response.json({ error: err.message, code: err.code }, { status: err.httpStatus });
    }
    const videosData = await videosRes.json();

    type VideoDetail = {
      id: string;
      snippet: { title: string; description: string; channelTitle: string; publishedAt: string };
      contentDetails: { duration: string };
      statistics: { viewCount?: string };
    };
    const videoMap = new Map<string, VideoDetail>();
    for (const v of (videosData.items ?? []) as VideoDetail[]) videoMap.set(v.id, v);

    const results = items
      .filter((i) => videoMap.has(i.id.videoId))
      .map((i) => {
        const v = videoMap.get(i.id.videoId)!;
        const durationSec = parseIsoDuration(v.contentDetails?.duration ?? "PT0S");
        const analysis = analyzeBeatInfo(v.snippet.title, v.snippet.description ?? "", "");
        return {
          id: i.id.videoId,
          url: `https://www.youtube.com/watch?v=${i.id.videoId}`,
          duration: formatYtDuration(durationSec),
          durationSec,
          thumbnail:
            i.snippet.thumbnails.high?.url ??
            i.snippet.thumbnails.medium?.url ??
            `https://i.ytimg.com/vi/${i.id.videoId}/hqdefault.jpg`,
          viewCount: parseInt(v.statistics?.viewCount ?? "0", 10) || null,
          uploader: v.snippet.channelTitle || null,
          uploadDate: toUploadDate(v.snippet.publishedAt),
          ...analysis,
        };
      });

    persistToCache(results);
    return Response.json({ results, nextPageToken: nextPageToken ?? null, hasMore: !!nextPageToken });
  } catch {
    return Response.json({ error: "Search failed" }, { status: 500 });
  }
}

// ── Mode B: yt-dlp ──────────────────────────────────────────────
// pageToken is the page number encoded as a string ("1", "2", …)

async function ytDlpSearch(
  query: string,
  dateFilter: string | null,
  pageToken: string | null
) {
  const page = Math.min(MAX_PAGE, Math.max(1, parseInt(pageToken || "1", 10)));
  const ytdlp = getYtDlpPath();
  const fetchCount = page * PAGE_SIZE;

  const args = [
    `ytsearch${fetchCount}:${query}`,
    "--dump-json",
    "--no-download",
    "--no-playlist",
    "--no-warnings",
  ];
  if (dateFilter) args.push("--dateafter", computeDateAfter(dateFilter));

  try {
    const { stdout } = await execFileAsync(ytdlp, args, {
      timeout: 45000,
      maxBuffer: 50 * 1024 * 1024,
    });

    const lines = stdout.trim().split("\n").filter(Boolean);
    const allResults = lines.map((line) => {
      const data = JSON.parse(line);
      const id: string = data.id || "";
      const title: string = data.title || "Untitled";
      const description: string = data.description || "";
      const duration = data.duration || 0;
      const thumbnail: string = data.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      const analysis = analyzeBeatInfo(title, description, "");
      return {
        id,
        url: `https://www.youtube.com/watch?v=${id}`,
        duration: formatDuration(Math.round(duration)),
        durationSec: Math.round(duration),
        thumbnail,
        viewCount: typeof data.view_count === "number" ? data.view_count : null,
        uploader: (data.uploader || data.channel || null) as string | null,
        uploadDate: (data.upload_date || null) as string | null,
        ...analysis,
      };
    });

    const pageResults = allResults.slice((page - 1) * PAGE_SIZE);
    const hasMore = page < MAX_PAGE && lines.length >= fetchCount;
    const nextPageToken = hasMore ? String(page + 1) : null;

    persistToCache(pageResults);
    return Response.json({ results: pageResults, nextPageToken, hasMore });
  } catch {
    return Response.json({ error: "Search failed" }, { status: 500 });
  }
}
