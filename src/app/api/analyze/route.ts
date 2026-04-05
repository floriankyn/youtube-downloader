import { type NextRequest } from "next/server";
import { execFileAsync, getYtDlpPath, isValidYouTubeUrl, analyzeBeatInfo, parseTimecodes } from "@/app/lib/ytdlp";
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/prisma";
import { YT_API_BASE, parseYouTubeError } from "@/app/lib/youtube";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { youtubeApiKey: true },
  });

  const url = request.nextUrl.searchParams.get("url");
  if (!url) return Response.json({ error: "Missing url" }, { status: 400 });
  if (!isValidYouTubeUrl(url)) return Response.json({ error: "Invalid YouTube URL" }, { status: 400 });

  return dbUser?.youtubeApiKey
    ? youtubeApiAnalyze(url, dbUser.youtubeApiKey)
    : ytDlpAnalyze(url);
}

// ── Mode A: YouTube Data API v3 ─────────────────────────────────

async function youtubeApiAnalyze(url: string, apiKey: string) {
  const videoId = url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
  if (!videoId) return Response.json({ error: "Could not extract video ID" }, { status: 400 });

  try {
    const videosRes = await fetch(
      `${YT_API_BASE}/videos?part=snippet,statistics&id=${videoId}&key=${apiKey}`
    );
    if (!videosRes.ok) {
      const body = await videosRes.json().catch(() => null);
      const err = parseYouTubeError(videosRes.status, body);
      return Response.json({ error: err.message, code: err.code }, { status: err.httpStatus });
    }
    const videosData = await videosRes.json();
    const item = videosData.items?.[0];
    if (!item) return Response.json({ error: "Video not found" }, { status: 404 });

    const title: string = item.snippet.title ?? "";
    const description: string = item.snippet.description ?? "";

    let comments = "";
    try {
      const commentsRes = await fetch(
        `${YT_API_BASE}/commentThreads?part=snippet&videoId=${videoId}&maxResults=30&order=relevance&key=${apiKey}`
      );
      if (commentsRes.ok) {
        const commentsData = await commentsRes.json();
        comments = ((commentsData.items ?? []) as { snippet: { topLevelComment: { snippet: { textDisplay: string } } } }[])
          .map((c) => c.snippet.topLevelComment.snippet.textDisplay)
          .join("\n");
      }
    } catch {
      // Comments disabled or unavailable — continue without them
    }

    return Response.json({ ...analyzeBeatInfo(title, description, comments), timecodes: parseTimecodes(description) });
  } catch {
    return Response.json({ error: "Failed to analyze video" }, { status: 500 });
  }
}

// ── Mode B: yt-dlp ──────────────────────────────────────────────

async function ytDlpAnalyze(url: string) {
  const ytdlp = getYtDlpPath();

  try {
    const { stdout: meta } = await execFileAsync(
      ytdlp,
      ["--print", "%(title)s\n---SPLIT---\n%(description)s", "--no-playlist", "--no-warnings", url],
      { timeout: 20000 }
    );

    const [title, ...descParts] = meta.split("---SPLIT---");
    const description = descParts.join("---SPLIT---").trim();

    let comments = "";
    try {
      const { stdout: commentsRaw } = await execFileAsync(
        ytdlp,
        [
          "--write-comments",
          "--extractor-args", "youtube:max_comments=30",
          "--print", "%(comments.:.text)j",
          "--no-download", "--no-playlist", "--no-warnings",
          url,
        ],
        { timeout: 30000 }
      );
      try {
        const parsed = JSON.parse(commentsRaw.trim());
        if (Array.isArray(parsed)) comments = parsed.slice(0, 30).join("\n");
      } catch {
        comments = commentsRaw.trim().slice(0, 3000);
      }
    } catch {
      // Comments disabled or unavailable
    }

    const analysis = analyzeBeatInfo(title.trim(), description, comments);
    return Response.json({ ...analysis, timecodes: parseTimecodes(description) });
  } catch {
    return Response.json({ error: "Failed to analyze video" }, { status: 500 });
  }
}
