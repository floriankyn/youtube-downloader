"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";

type Format = "mp3" | "mp4" | "wav";

function DownloaderForm() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<Format>(
    (searchParams.get("format") as Format) || "mp4"
  );
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("format", format);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [format, router]);

  async function handleDownload() {
    if (!url.trim()) {
      setError("Please paste a YouTube URL");
      return;
    }

    setError("");
    setDownloading(true);

    try {
      const params = new URLSearchParams({ url, format });
      const res = await fetch(`/api/download?${params.toString()}`);

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Download failed (${res.status})`);
      }

      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="(.+)"/);
      const filename = match ? match[1] : `video.${format}`;

      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  const formats: { value: Format; label: string }[] = [
    { value: "mp4", label: "MP4 (Video)" },
    { value: "mp3", label: "MP3 (Audio)" },
    { value: "wav", label: "WAV (Audio)" },
  ];

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-4">
      <div className="w-full max-w-lg space-y-6">
        <h1 className="text-3xl font-bold text-center">YouTube Downloader</h1>

        <input
          type="text"
          placeholder="Paste YouTube URL here..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 dark:border-zinc-700 dark:bg-zinc-900"
        />

        <div className="flex gap-2">
          {formats.map((f) => (
            <button
              key={f.value}
              onClick={() => setFormat(f.value)}
              className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                format === f.value
                  ? "border-red-500 bg-red-500 text-white"
                  : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button
          onClick={handleDownload}
          disabled={downloading}
          className="w-full rounded-lg bg-red-600 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloading ? "Downloading..." : "Download"}
        </button>

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
