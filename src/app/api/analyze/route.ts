import { type NextRequest } from "next/server";
import { isValidYouTubeUrl, analyzeBeatInfo, parseTimecodes } from "@/app/lib/ytdlp";
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
  if (!dbUser?.youtubeApiKey) {
    return Response.json({ error: "YouTube API key required.", code: "NO_API_KEY" }, { status: 403 });
  }

  const url = request.nextUrl.searchParams.get("url");
  if (!url) return Response.json({ error: "Missing url" }, { status: 400 });
  if (!isValidYouTubeUrl(url)) return Response.json({ error: "Invalid YouTube URL" }, { status: 400 });

  const videoId = url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
  if (!videoId) return Response.json({ error: "Could not extract video ID" }, { status: 400 });

  const apiKey = dbUser.youtubeApiKey;

  try {
    // Fetch video snippet + statistics
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

    // Fetch top comments (optional — disabled videos are handled gracefully)
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

    const analysis = analyzeBeatInfo(title, description, comments);
    const timecodes = parseTimecodes(description);

    return Response.json({ ...analysis, timecodes });
  } catch {
    return Response.json({ error: "Failed to analyze video" }, { status: 500 });
  }
}
