import { type NextRequest } from "next/server";
import {
  execFileAsync,
  getYtDlpPath,
  analyzeBeatInfo,
} from "@/app/lib/ytdlp";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q");

  if (!query || !query.trim()) {
    return Response.json({ error: "Missing search query" }, { status: 400 });
  }

  const ytdlp = getYtDlpPath();

  try {
    // Use --dump-json for reliable structured output
    const { stdout } = await execFileAsync(
      ytdlp,
      [
        `ytsearch10:${query.trim()}`,
        "--dump-json",
        "--no-download",
        "--no-playlist",
        "--no-warnings",
      ],
      { timeout: 30000, maxBuffer: 50 * 1024 * 1024 }
    );

    // Each line is a separate JSON object
    const lines = stdout.trim().split("\n").filter(Boolean);

    const results = lines.map((line) => {
      const data = JSON.parse(line);
      const id = data.id || "";
      const title = data.title || "Untitled";
      const description = data.description || "";
      const duration = data.duration || 0;
      const thumbnail =
        data.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

      const analysis = analyzeBeatInfo(title, description, "");

      return {
        id,
        url: `https://www.youtube.com/watch?v=${id}`,
        duration: formatDuration(Math.round(duration)),
        durationSec: Math.round(duration),
        thumbnail,
        ...analysis,
      };
    });

    return Response.json({ results });
  } catch {
    return Response.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
