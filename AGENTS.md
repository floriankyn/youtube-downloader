<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Music Craftbook — Agent Memory

## What this app is

A music production web app. Users search YouTube for beats, preview and download them, save favorites, and write lyrics with voice notes that can be recorded in sync with the beat.

---

## Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16.2.2 — App Router, `proxy.ts` (not `middleware.ts`) |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| ORM | Prisma 5 + PostgreSQL |
| Auth | JWT via `jose`, `bcryptjs`, `httpOnly` cookies |
| YouTube | `yt-dlp` binary (`bin/yt-dlp_linux` in container) |
| Audio conversion | `ffmpeg-static` |
| Runtime | Node.js 22, Docker Compose |

---

## Critical Next.js v16 conventions

- Middleware file is **`proxy.ts`** at the project root, exporting `async function proxy()` — NOT `middleware.ts` / `middleware()`.
- Route params are a **Promise** in page components and route handlers: `const { videoId } = await params`.
- Always read `node_modules/next/dist/docs/` before touching routing or middleware.

---

## Project structure

```
app/
  page.tsx              # Main page — three tabs: Paste URL, Search YouTube, Favorites
  layout.tsx            # App title "Music Craftbook", global metadata
  globals.css
  api/
    auth/               # login, logout, signup, me
    search/route.ts     # YouTube search via yt-dlp (requires auth)
    analyze/route.ts    # Single-video metadata extraction
    download/route.ts   # Stream download (MP4 / MP3 / WAV)
    preview/route.ts    # Audio preview stream
    favorites/route.ts  # GET / POST / DELETE favorites
    notes/[videoId]/route.ts  # GET + PUT note blocks
  notes/[videoId]/page.tsx    # Full lyrics/notes editor
proxy.ts                # Auth middleware — protects /api/search, /api/favorites, /api/notes
prisma/
  schema.prisma         # User, Favorite, Note models
  migrations/           # 4 migrations (init → favorites → filters → notes)
```

---

## Data models

**User** — `id`, `email`, `passwordHash`, `createdAt`

**Favorite** — `userId`, `videoId`, `title`, `thumbnail`, `duration`, `durationSec`, `url`, `bpm?`, `key?`, `beatType?`, `inspiredBy[]`, `tags[]`, `dateFilter?`, `freeFilter`, `artistFilter?`, `typeBeat` — plus unique `[userId, videoId]`

**Note** — `userId`, `videoId`, `blocks Json` (array of `TextBlock | VoiceBlock`) — unique `[userId, videoId]`

### Note block shapes

```ts
interface TextBlock { id: string; type: "text"; content: string; }

interface VoiceBlock {
  id: string; type: "voice";
  audioBase64: string; mimeType: string;
  duration: number; createdAt: string;
  beatTimecode: number | null; // beat playback position when recording started (after lead-in)
}
```

---

## Auth

- `POST /api/auth/signup` — creates user, sets session cookie
- `POST /api/auth/login` — verifies password, sets session cookie
- `POST /api/auth/logout` — clears cookie
- `GET /api/auth/me` — returns `{ user }` or 401
- Session: encrypted JWT in `httpOnly` cookie, 7-day expiry
- `app/lib/jwt.ts` — `encrypt` / `decrypt`
- `app/lib/session.ts` — `getSession()` (server-side helper)
- `app/lib/prisma.ts` — singleton Prisma client

---

## Key patterns & gotchas

### Stale closure fix in `useRecorder`
`recorder.onstop` captures a stale callback. Fix: assign `onDoneRef.current = onDone` directly in the render body (not in a `useEffect`) so the closure always calls the latest version.

### Functional `setBlocks` updates
All block mutations use `setBlocks(prev => ...)` to avoid operating on stale state from when a recording started.

### `BeatPlayer` is a `forwardRef` component
Exposes `BeatPlayerHandle`: `{ getCurrentTime, getDuration, pause, loadAndPlayFrom }`. The ref is used by the page to capture beat timecode on record start and to seek/play on "Play with beat".

### Beat-synced voice notes
- User picks a beat position in the `InsertBar` picker (timecode input + arrow keys + slider + live preview)
- Optional −5s lead-in (toggle, default on): beat starts at `max(0, chosen - 5)`
- `beatTimecode` stored on the block = actual beat start time (after applying lead-in)
- Playback: "▶" = voice only, "▶ + beat" = both in sync from `beatTimecode`

### Audio device selection
- Mic icon in notes header opens a device panel
- Enumerates devices after a brief `getUserMedia` call (required for labels)
- `inputDeviceId` passed to `useRecorder` via ref — uses `{ deviceId: { ideal: id } }` constraint
- `outputDeviceId` applied via `setSinkId()` on `<audio>` elements in `VoicePlayer` and `BeatPlayer`

### Voice note progress bar
Uses `block.duration` as fallback denominator when `audio.duration` is not yet loaded (`isFinite(a.duration) && a.duration > 0 ? a.duration : block.duration`).

---

## Docker / deployment

- `node:22-slim` base image — OpenSSL 3.x
- Prisma `binaryTargets`: `["native", "linux-arm64-openssl-3.0.x"]` — required for the container runtime
- **Do NOT copy `package-lock.json` into the Docker deps stage** — it was generated on macOS and locks macOS native binary paths (lightningcss etc.), causing build failures on Linux. The `deps` stage copies only `package.json` and runs `npm install` fresh.
- Standalone Next.js output (`output: "standalone"` in `next.config.ts`)
- Container entrypoint: `prisma migrate deploy && node server.js`
- `ffmpeg` installed via `apt-get` in the runner stage
- `yt-dlp` binary at `bin/yt-dlp_linux`, copied into the runner stage

### Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for session token signing |

Pass via `.env.local` when running locally, or Docker Compose env file.
