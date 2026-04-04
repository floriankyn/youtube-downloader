import { type NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { getYtDlpPath, getFfmpegPath, isValidYouTubeUrl } from "@/app/lib/ytdlp";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return Response.json({ error: "Missing url" }, { status: 400 });
  }

  if (!isValidYouTubeUrl(url)) {
    return Response.json({ error: "Invalid YouTube URL" }, { status: 400 });
  }

  const ytdlp = getYtDlpPath();
  const ffmpeg = getFfmpegPath();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      function safeEnqueue(chunk: Uint8Array) {
        if (!closed) {
          try { controller.enqueue(chunk); } catch { closed = true; }
        }
      }

      function safeClose() {
        if (!closed) {
          closed = true;
          try { controller.close(); } catch {}
        }
      }

      function safeError(err: Error) {
        if (!closed) {
          closed = true;
          try { controller.error(err); } catch {}
        }
      }

      const ytProc = spawn(ytdlp, [
        "--no-playlist",
        "--no-warnings",
        "-f", "bestaudio",
        "-o", "-",
        url,
      ], { stdio: ["ignore", "pipe", "pipe"] });

      const ffProc = spawn(ffmpeg, [
        "-i", "pipe:0",
        "-f", "mp3",
        "-ab", "128k",
        "-ac", "2",
        "-ar", "44100",
        "pipe:1",
      ], { stdio: ["pipe", "pipe", "ignore"] });

      ytProc.stdout.pipe(ffProc.stdin);

      ytProc.stderr.on("data", () => {});
      ytProc.on("error", () => {
        ffProc.kill();
        safeError(new Error("yt-dlp failed"));
      });
      ffProc.stdin.on("error", () => {});

      ffProc.stdout.on("data", (chunk: Buffer) => {
        safeEnqueue(new Uint8Array(chunk));
      });

      ffProc.on("close", (code) => {
        ytProc.kill();
        if (code === 0) {
          safeClose();
        } else {
          safeError(new Error("Preview failed"));
        }
      });

      ffProc.on("error", (err) => {
        ytProc.kill();
        safeError(err);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
