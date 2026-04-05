import { type NextRequest } from "next/server";
import { analyzeBeatInfo } from "@/app/lib/ytdlp";
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/prisma";
import {
  YT_API_BASE,
  parseIsoDuration,
  formatYtDuration,
  toUploadDate,
  parseYouTubeError,
} from "@/app/lib/youtube";

export const maxDuration = 30;

const PAGE_SIZE = 15;

function computePublishedAfter(filter: string): string {
  const d = new Date();
  switch (filter) {
    case "year":     d.setFullYear(d.getFullYear() - 1); break;
    case "6months":  d.setMonth(d.getMonth() - 6); break;
    case "1month":   d.setMonth(d.getMonth() - 1); break;
    case "2weeks":   d.setDate(d.getDate() - 14); break;
    case "1week":    d.setDate(d.getDate() - 7); break;
    case "1day":     d.setDate(d.getDate() - 1); break;
  }
  return d.toISOString();
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { youtubeApiKey: true },
  });

  if (!dbUser?.youtubeApiKey) {
    return Response.json({ error: "YouTube API key required.", code: "NO_API_KEY" }, { status: 403 });
  }

  const apiKey = dbUser.youtubeApiKey;
  const query = request.nextUrl.searchParams.get("q");
  const dateFilter = request.nextUrl.searchParams.get("dateFilter");
  const pageToken = request.nextUrl.searchParams.get("pageToken");

  if (!query?.trim()) {
    return Response.json({ error: "Missing search query" }, { status: 400 });
  }

  try {
    // 1 — search.list: get video IDs + basic snippet
    const searchParams = new URLSearchParams({
      part: "snippet",
      type: "video",
      q: query.trim(),
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
      snippet: {
        thumbnails: { high?: { url: string }; medium?: { url: string } };
      };
    };
    const items: SearchItem[] = searchData.items ?? [];
    const nextPageToken: string | undefined = searchData.nextPageToken;

    if (items.length === 0) {
      return Response.json({ results: [], nextPageToken: null, hasMore: false });
    }

    // 2 — videos.list: get duration, statistics, full snippet
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
    for (const v of (videosData.items ?? []) as VideoDetail[]) {
      videoMap.set(v.id, v);
    }

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

    // Persist to video cache (fire-and-forget)
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

    return Response.json({ results, nextPageToken: nextPageToken ?? null, hasMore: !!nextPageToken });
  } catch {
    return Response.json({ error: "Search failed" }, { status: 500 });
  }
}
