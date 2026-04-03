import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const execFileAsync = promisify(execFile);

export function getYtDlpPath(): string {
  const bundled = join(process.cwd(), "bin", "yt-dlp_linux");
  if (process.platform === "linux" && existsSync(bundled)) {
    return bundled;
  }
  return "yt-dlp";
}

export function getFfmpegPath(): string {
  const bundled = join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");
  if (existsSync(bundled)) {
    return bundled;
  }
  return "ffmpeg";
}

export function isValidYouTubeUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/.test(url);
}

export interface BeatAnalysis {
  title: string;
  bpm: string | null;
  key: string | null;
  beatType: string | null;
  inspiredBy: string[];
  tags: string[];
}

export function analyzeBeatInfo(
  title: string,
  description: string,
  comments: string
): BeatAnalysis {
  const all = `${title}\n${description}\n${comments}`;
  const allLower = all.toLowerCase();

  // Extract BPM
  let bpm: string | null = null;
  const bpmPatterns = [
    /(\d{2,3})\s*bpm/i,
    /bpm\s*[:\-–]?\s*(\d{2,3})/i,
    /tempo\s*[:\-–]?\s*(\d{2,3})/i,
  ];
  for (const pat of bpmPatterns) {
    const m = all.match(pat);
    if (m) {
      const val = parseInt(m[1]);
      if (val >= 40 && val <= 300) {
        bpm = `${val} BPM`;
        break;
      }
    }
  }

  // Extract key
  let key: string | null = null;
  const keyPatterns = [
    /\b([A-G][#b]?\s*(?:major|minor|maj|min))\b/i,
    /key\s*(?:of\s+)?[:\-–]?\s*([A-G][#b]?\s*(?:major|minor|maj|min)?(?:\s*m)?)\b/i,
    /\b([A-G][#b]?m(?:aj|in)?(?:or)?)\b/i,
  ];
  for (const pat of keyPatterns) {
    const m = all.match(pat);
    if (m) {
      key = m[1].trim();
      break;
    }
  }

  // Extract beat type from title/description
  let beatType: string | null = null;
  const beatTypes = [
    "trap", "drill", "uk drill", "ny drill", "boom bap", "lo-fi", "lofi",
    "r&b", "rnb", "soul", "jazz", "afrobeat", "afro", "reggaeton",
    "dancehall", "pop", "rock", "dark", "melodic", "hard", "aggressive",
    "chill", "ambient", "plugg", "rage", "hyperpop", "jersey club",
    "phonk", "memphis", "west coast", "east coast", "southern",
    "type beat", "guitar", "piano", "flute", "orchestral", "cinematic",
    "emotional", "sad", "hype", "bouncy", "smooth",
  ];
  const foundTypes: string[] = [];
  for (const bt of beatTypes) {
    if (allLower.includes(bt)) {
      foundTypes.push(bt);
    }
  }
  if (foundTypes.length > 0) {
    const meaningful = foundTypes.filter((t) => t !== "type beat");
    beatType = (meaningful.length > 0 ? meaningful : foundTypes)
      .slice(0, 3)
      .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
      .join(" / ");
  }

  // Extract artist references
  const inspiredBy: string[] = [];
  const typePatterns = [
    /([A-Z][a-zA-Z0-9$. ]+?)\s+type\s+beat/gi,
    /type\s+(?:beat\s+)?[–\-]\s*([A-Z][a-zA-Z0-9$. ]+)/gi,
    /inspired\s+by\s+([A-Z][a-zA-Z0-9$., &]+)/gi,
    /style\s*(?:of|:)\s*([A-Z][a-zA-Z0-9$., &]+)/gi,
  ];
  const seen = new Set<string>();
  for (const pat of typePatterns) {
    let m;
    while ((m = pat.exec(all)) !== null) {
      const names = m[1]
        .split(/[,&x×]/)
        .map((n) => n.trim())
        .filter((n) => n.length > 1 && n.length < 40);
      for (const name of names) {
        const lower = name.toLowerCase();
        if (
          !seen.has(lower) &&
          !["free", "hard", "dark", "sad", "chill", "type", "beat", "prod", "2024", "2025", "2026"].includes(lower)
        ) {
          seen.add(lower);
          inspiredBy.push(name);
        }
      }
    }
  }

  // Extract tags
  const tags: string[] = [];
  const tagMatches = all.match(/#(\w+)/g);
  if (tagMatches) {
    for (const tag of tagMatches.slice(0, 8)) {
      tags.push(tag);
    }
  }

  return {
    title,
    bpm,
    key,
    beatType,
    inspiredBy: inspiredBy.slice(0, 5),
    tags: tags.slice(0, 6),
  };
}
