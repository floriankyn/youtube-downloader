import { type NextRequest } from "next/server";
import {
  execFileAsync,
  getYtDlpPath,
  isValidYouTubeUrl,
  analyzeBeatInfo,
  parseTimecodes,
} from "@/app/lib/ytdlp";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return Response.json({ error: "Missing url" }, { status: 400 });
  }

  if (!isValidYouTubeUrl(url)) {
    return Response.json({ error: "Invalid YouTube URL" }, { status: 400 });
  }

  const ytdlp = getYtDlpPath();

  try {
    const { stdout: meta } = await execFileAsync(
      ytdlp,
      [
        "--print", "%(title)s\n---SPLIT---\n%(description)s",
        "--no-playlist",
        "--no-warnings",
        url,
      ],
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
          "--no-download",
          "--no-playlist",
          "--no-warnings",
          url,
        ],
        { timeout: 30000 }
      );
      try {
        const parsed = JSON.parse(commentsRaw.trim());
        if (Array.isArray(parsed)) {
          comments = parsed.slice(0, 30).join("\n");
        }
      } catch {
        comments = commentsRaw.trim().slice(0, 3000);
      }
    } catch (error) {
        console.log(error);
      // Comments might be disabled or unavailable
    }

    const analysis = analyzeBeatInfo(title.trim(), description, comments);
    const timecodes = parseTimecodes(description);

    return Response.json({ ...analysis, timecodes });
  } catch (error) {
      console.log(error);
    return Response.json(
      { error: "Failed to analyze video" },
      { status: 500 }
    );
  }
}
