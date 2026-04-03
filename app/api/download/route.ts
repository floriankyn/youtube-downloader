import { type NextRequest } from "next/server";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
const execFileAsync = promisify(execFile);

const VALID_FORMATS = ["mp3", "mp4", "wav"] as const;
type Format = (typeof VALID_FORMATS)[number];

export const maxDuration = 60;

function getYtDlpPath(): string {
  const bundled = join(process.cwd(), "bin", "yt-dlp_linux");
  if (process.platform === "linux" && existsSync(bundled)) {
    return bundled;
  }
  return "yt-dlp";
}

function getFfmpegPath(): string {
  // On Vercel (Linux), use ffmpeg-static from node_modules resolved at runtime
  const bundled = join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");
  if (existsSync(bundled)) {
    return bundled;
  }
  // Fallback to system ffmpeg
  return "ffmpeg";
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  const format = request.nextUrl.searchParams.get("format") as Format | null;

  if (!url || !format) {
    return Response.json({ error: "Missing url or format" }, { status: 400 });
  }

  if (!VALID_FORMATS.includes(format)) {
    return Response.json({ error: "Invalid format" }, { status: 400 });
  }

  if (
    !url.match(
      /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/
    )
  ) {
    return Response.json({ error: "Invalid YouTube URL" }, { status: 400 });
  }

  const ytdlp = getYtDlpPath();

  // Get video title
  let title = "video";
  try {
    const { stdout } = await execFileAsync(ytdlp, [
      "--print", "%(title)s",
      "--no-playlist",
      "--no-warnings",
      url,
    ], { timeout: 15000 });
    title = stdout.trim();
  } catch {
    // fallback to "video"
  }

  const safeTitle = title.replace(/[^\w\s-]/g, "").trim() || "video";
  const filename = `${safeTitle}.${format}`;

  const contentType: Record<Format, string> = {
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
  };

  if (format === "mp4") {
    return streamMp4(ytdlp, url, filename, contentType[format]);
  }

  return streamAudio(ytdlp, url, format, filename, contentType[format]);
}

function streamMp4(
  ytdlp: string,
  url: string,
  filename: string,
  contentType: string
) {
  const stream = new ReadableStream({
    start(controller) {
      const proc = spawn(ytdlp, [
        "--no-playlist",
        "--no-warnings",
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "-o", "-",
        url,
      ], { stdio: ["ignore", "pipe", "pipe"] });

      proc.stdout.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });

      proc.on("close", (code) => {
        if (code === 0) {
          try { controller.close(); } catch {}
        } else {
          try { controller.error(new Error("Download failed")); } catch {}
        }
      });

      proc.on("error", (err) => {
        try { controller.error(err); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function streamAudio(
  ytdlp: string,
  url: string,
  format: Format,
  filename: string,
  contentType: string
) {
  const stream = new ReadableStream({
    start(controller) {
      // yt-dlp downloads audio and pipes raw stream to ffmpeg for conversion
      const ytProc = spawn(ytdlp, [
        "--no-playlist",
        "--no-warnings",
        "-f", "bestaudio",
        "-o", "-",
        url,
      ], { stdio: ["ignore", "pipe", "pipe"] });

      const ffmpegArgs =
        format === "mp3"
          ? ["-i", "pipe:0", "-f", "mp3", "-ab", "192k", "pipe:1"]
          : ["-i", "pipe:0", "-f", "wav", "pipe:1"];

      const ffmpeg = spawn(getFfmpegPath(), ffmpegArgs, {
        stdio: ["pipe", "pipe", "ignore"],
      });

      ytProc.stdout.pipe(ffmpeg.stdin);

      ytProc.stderr.on("data", () => {}); // drain stderr
      ytProc.on("error", () => { ffmpeg.kill(); });
      ffmpeg.stdin.on("error", () => {}); // ignore broken pipe

      ffmpeg.stdout.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          try { controller.close(); } catch {}
        } else {
          try { controller.error(new Error("Conversion failed")); } catch {}
        }
      });

      ffmpeg.on("error", (err) => {
        try { controller.error(err); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
