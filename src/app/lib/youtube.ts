export const YT_API_BASE = "https://www.googleapis.com/youtube/v3";

export function parseIsoDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || "0") * 3600) + (parseInt(m[2] || "0") * 60) + parseInt(m[3] || "0");
}

export function formatYtDuration(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** "2024-01-15T10:30:00Z" → "20240115" */
export function toUploadDate(publishedAt: string): string {
  return publishedAt.slice(0, 10).replace(/-/g, "");
}

export type YouTubeErrorCode = "NO_API_KEY" | "INVALID_KEY" | "QUOTA_EXCEEDED" | "API_ERROR";

export function parseYouTubeError(status: number, body: unknown): { code: YouTubeErrorCode; message: string; httpStatus: number } {
  const reason = (body as { error?: { errors?: { reason?: string }[] } })?.error?.errors?.[0]?.reason ?? "";
  if (status === 403) {
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
      return { code: "QUOTA_EXCEEDED", message: "YouTube API quota exceeded. Try again tomorrow.", httpStatus: 429 };
    }
    return { code: "INVALID_KEY", message: "Invalid YouTube API key. Please check your key in Settings.", httpStatus: 403 };
  }
  return { code: "API_ERROR", message: "YouTube API error.", httpStatus: 500 };
}
