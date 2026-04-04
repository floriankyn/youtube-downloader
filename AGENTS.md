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
| Auth | JWT via `jose`, `bcryptjs`, `httpOnly` cookies, Google OAuth 2.0 |
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
src/
  app/
    page.tsx              # Main page — four tabs: Paste URL, Search YouTube, Favorites, Songs
    layout.tsx            # App title "Music Craftbook", global metadata
    globals.css
    api/
      auth/               # login, logout, signup, me
        google/route.ts       # Google OAuth — redirects to Google consent screen
        google/callback/route.ts  # Google OAuth callback — exchanges code, creates session
      search/route.ts     # YouTube search via yt-dlp (requires auth)
      analyze/route.ts    # Single-video metadata extraction
      download/route.ts   # Stream download (MP4 / MP3 / WAV)
      preview/route.ts    # Audio preview stream
      favorites/route.ts  # GET / POST / PATCH / DELETE favorites
      notes/[videoId]/route.ts  # GET + PUT note blocks (includes song metadata)
      songs/route.ts      # GET notes with songName set (no proxy — uses getSession)
      view/[publicId]/route.ts  # Public note view (no auth)
      user/route.ts             # DELETE — delete account (GDPR Art. 17, cascade)
      user/email/route.ts       # PATCH — change email
      user/password/route.ts    # PATCH — change or set password
      user/export/route.ts      # GET — export all user data as JSON (GDPR Art. 20)
    notes/[videoId]/page.tsx    # Full lyrics/notes editor
    view/[publicId]/page.tsx    # Read-only public share page
    settings/page.tsx           # Account settings (email, password, export, delete)
  proxy.ts                # Auth middleware — protects /api/search, /api/favorites, /api/notes, /api/user
prisma/
  schema.prisma         # User, Favorite, Note models
  migrations/           # 7 migrations (init → … → note_song_metadata → google_auth)
```

---

## Data models

**User** — `id`, `email`, `passwordHash?` (null for Google-only accounts), `googleId?` (unique), `createdAt`

**Favorite** — `userId`, `videoId`, `title`, `thumbnail`, `duration`, `durationSec`, `url`, `bpm?`, `key?`, `beatType?`, `inspiredBy[]`, `tags[]`, `dateFilter?`, `freeFilter`, `artistFilter?`, `typeBeat` — plus unique `[userId, videoId]`

**Note** — `userId`, `videoId`, `blocks Json`, `timecodes Json`, `songName?`, `isPublic`, `publicId?` (unique share slug), `bpm?`, `key?`, `beatType?`, `videoTitle?`, `videoThumbnail?`, `videoUrl?` — unique `[userId, videoId]`

### Note block shapes

```ts
interface TextBlock { id: string; type: "text"; content: string; }

interface VoiceBlock {
  id: string; type: "voice";
  audioBase64: string; mimeType: string;
  duration: number; createdAt: string;
  beatTimecode: number | null; // beat playback position when recording started (after lead-in)
  sectionTag: string | null;  // timecode section label active when recording started
}

interface Timecode { id: string; time: number; label: string; }
// Stored on Note.timecodes (Json column), not in the blocks array.
```

---

## Auth

- `POST /api/auth/signup` — creates user, sets session cookie
- `POST /api/auth/login` — verifies password (rejects if `passwordHash` is null — Google-only account)
- `POST /api/auth/logout` — clears cookie
- `GET /api/auth/me` — returns `{ user: { id, email, createdAt, hasPassword } }` or `{ user: null }`
- `GET /api/auth/google` — redirects to Google consent screen (state cookie for CSRF)
- `GET /api/auth/google/callback` — exchanges code for token, fetches Google user info, finds/creates/links user, creates session
- Session: encrypted JWT in `httpOnly` cookie, 7-day expiry
- `app/lib/jwt.ts` — `encrypt` / `decrypt`
- `app/lib/session.ts` — `getSession()`, `createSession()`, `deleteSession()` (server-side helpers)
- `app/lib/prisma.ts` — singleton Prisma client

### Google OAuth account linking
When a user signs in with Google and their Google email matches an existing email/password account, `googleId` is written to that existing row — accounts are merged automatically. Subsequent Google sign-ins find the user by `googleId` directly.

---

## Key patterns & gotchas

### Stale closure fix in `useRecorder`
`recorder.onstop` captures a stale callback. Fix: assign `onDoneRef.current = onDone` directly in the render body (not in a `useEffect`) so the closure always calls the latest version.

### Functional `setBlocks` updates
All block mutations use `setBlocks(prev => ...)` to avoid operating on stale state from when a recording started.

### `BeatPlayer` is a `forwardRef` component
Exposes `BeatPlayerHandle`: `{ getCurrentTime, getDuration, pause, loadAndPlayFrom }`. The ref is used by the page to capture beat timecode on record start and to seek/play on "Play with beat".

### Timecode system
- `Note.timecodes` — separate `Json` column (not in blocks array). Shape: `Timecode[]`.
- `parseTimecodes(text)` in `app/lib/ytdlp.ts` — extracts `0:00 Intro` style entries from a string. Used by `GET /api/analyze` which now returns a `timecodes` field alongside beat analysis.
- `TimecodeTimeline` component — rAF-driven playhead (reads `beatPlayerRef.current?.getCurrentTime()` at 60fps). Click anywhere on the bar to seek. Labels positioned absolutely at `(time / duration) * 100%`. Edit icon opens `TimecodeEditor`.
- `TimecodeEditor` component — shown at top of content area (not sticky header). "Detect from video" button calls `/api/analyze` and imports parsed timecodes. "Add at X" button adds a timecode at current beat position.
- Auto-tag on recording: `getSectionAtTime(timecodes, currentTime)` finds the active section. Regular recording tags if `beatPlayerRef.current?.isPlaying()`. Beat-sync recording always tags using the *chosen* timecode (not the lead-in start).
- Migration `20260403000004_note_timecodes` adds the column.

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
| `SESSION_SECRET` | Secret for session JWT signing |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret |
| `APP_URL` | Public base URL — used as OAuth redirect base (e.g. `http://localhost:3000`) |

- `.env.local` — read by Next.js dev server
- `.env` — read by Prisma CLI (`prisma migrate deploy` etc.)
- Both files are git-ignored via `.gitignore` (`env*` rule)
