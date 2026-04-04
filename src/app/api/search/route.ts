import { type NextRequest } from "next/server";
import {
  execFileAsync,
  getYtDlpPath,
  analyzeBeatInfo,
} from "@/app/lib/ytdlp";
import { getSession } from "@/app/lib/session";

export const maxDuration = 60;

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

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q");
  const dateFilter = request.nextUrl.searchParams.get("dateFilter");

  if (!query || !query.trim()) {
    return Response.json({ error: "Missing search query" }, { status: 400 });
  }

  const ytdlp = getYtDlpPath();

  const args = [
    `ytsearch15:${query.trim()}`,
    "--dump-json",
    "--no-download",
    "--no-playlist",
    "--no-warnings",
  ];

  if (dateFilter) {
    args.push("--dateafter", computeDateAfter(dateFilter));
  }

  try {
    const { stdout } = await execFileAsync(ytdlp, args, {
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024,
    });

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
    return Response.json({ error: "Search failed" }, { status: 500 });
  }
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
