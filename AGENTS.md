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

- Middleware file is **`src/proxy.ts`** (inside `src/`, at the same level as `src/app/`), exporting `async function proxy()` — NOT `middleware.ts` / `middleware()`.
- **`src/app/` is silently ignored by Next.js if a root-level `app/` directory exists.** Never let a root `app/` accumulate — it will shadow all routes in `src/app/` with no error.
- Route params are a **Promise** in page components and route handlers: `const { videoId } = await params`.
- Always read `node_modules/next/dist/docs/` before touching routing or middleware.

---

## Project structure

```
src/
  app/
    page.tsx              # Main page — five tabs: Paste URL, Search YouTube, Favorites, Songs, Blocked
    layout.tsx            # App title "Music Craftbook", global metadata
    globals.css
    api/
      auth/               # login, logout, signup, me
        google/route.ts       # Google OAuth — redirects to Google consent screen
        google/callback/route.ts  # Google OAuth callback — exchanges code, creates session
      search/route.ts     # YouTube search via YouTube Data API v3 — accepts pageToken, returns nextPageToken
      analyze/route.ts    # Single-video metadata extraction via YouTube Data API v3
      download/route.ts   # Stream download (MP4 / MP3 / WAV)
      preview/route.ts    # Audio preview stream
      favorites/route.ts  # GET / POST / PATCH / DELETE favorites
      notes/[videoId]/route.ts        # GET + PUT note blocks (includes song metadata)
      notes/[videoId]/collab/route.ts # POST — generate editToken; DELETE — revoke
      songs/route.ts      # GET / PATCH (move to folder) notes with songName set
      songs/folder/route.ts           # PATCH rename folder; DELETE delete folder
      tags/route.ts       # GET / POST / PATCH / DELETE user search tags
      banned/route.ts     # GET / POST / DELETE banned videos (never-show-again)
      view/[publicId]/route.ts  # Public note view (no auth)
      collab/[editToken]/route.ts  # GET — load note+favorite for collaborator join
      user/route.ts             # DELETE — delete account (GDPR Art. 17, cascade)
      user/email/route.ts       # PATCH — change email
      user/password/route.ts    # PATCH — change or set password
      user/youtube-key/route.ts # PATCH — save/clear YouTube Data API key
      user/export/route.ts      # GET — export all user data as JSON (GDPR Art. 20)
    notes/[videoId]/page.tsx    # Full lyrics/notes editor (+ real-time collab via Socket.io)
    view/[publicId]/page.tsx    # Read-only public share page
    settings/page.tsx           # Account settings (email, password, export, delete)
  proxy.ts                # Auth middleware — protects /api/search, /api/favorites, /api/notes, /api/user, /api/collab, /api/songs, /api/tags, /api/banned, /api/analyze
server.ts               # Custom HTTP server: wraps Next.js + mounts Socket.io on the same port
prisma/
  schema.prisma         # User, Favorite, Note, SearchTag, BannedVideo, CachedVideo models
  migrations/           # 13 migrations (init → … → search_tags → banned_videos → cached_videos → user_youtube_api_key)
```

---

## Data models

**User** — `id`, `email`, `passwordHash?` (null for Google-only accounts), `googleId?` (unique), `youtubeApiKey?`, `createdAt`

**Favorite** — `userId`, `videoId`, `title`, `thumbnail`, `duration`, `durationSec`, `url`, `bpm?`, `key?`, `beatType?`, `inspiredBy[]`, `tags[]`, `dateFilter?`, `freeFilter`, `artistFilter?`, `typeBeat` — plus unique `[userId, videoId]`

**Note** — `userId`, `videoId`, `blocks Json`, `timecodes Json`, `songName?`, `folder?`, `isPublic`, `publicId?` (unique share slug), `editToken?` (unique collab invite token), `bpm?`, `key?`, `beatType?`, `videoTitle?`, `videoThumbnail?`, `videoUrl?` — unique `[userId, videoId]`

**SearchTag** — `id`, `userId`, `name`, `createdAt` — unique `[userId, name]`. Stores a user's persistent search keyword tags. Cascade-deleted with the user.

**BannedVideo** — `id`, `userId`, `videoId`, `title`, `thumbnail`, `uploader?`, `url`, `createdAt` — unique `[userId, videoId]`. Videos the user never wants to see again in search. Cascade-deleted with the user.

**CachedVideo** — `videoId` (PK), `title`, `thumbnail`, `duration`, `durationSec`, `url`, `viewCount?`, `uploader?`, `uploadDate?`, `updatedAt`. Global (not per-user). Every video returned by `/api/search` is upserted here fire-and-forget. No user relation — not cascade-deleted.

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
- `src/app/lib/jwt.ts` — `encrypt` / `decrypt`
- `src/app/lib/session.ts` — `getSession()`, `createSession()`, `deleteSession()` (server-side helpers)
- `src/app/lib/prisma.ts` — singleton Prisma client

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

### Songs tab — folder organization
- `Note.folder` (`String?`) groups notes in the Songs tab.
- `PATCH /api/songs` — moves a song: `{ videoId, folder: string | null }`.
- `PATCH /api/songs/folder` — renames a folder: `{ from, to }` (bulk-updates all notes with that folder).
- `DELETE /api/songs/folder` — deletes a folder (sets `folder = null` on all songs in it, notes kept).
- UI: songs grouped by folder (collapsible, amber folder icon) then "Unfiled". Folder header has inline rename and delete. Per-song "Add to folder" / "Move folder" opens a picker panel with existing folders + create-new input.

### YouTube Data API v3
- Search and analyze use the **YouTube Data API v3** (not yt-dlp). Each user stores their own `youtubeApiKey` in the DB (`User.youtubeApiKey`).
- `GET /api/auth/me` returns `hasYoutubeKey: boolean` — never exposes the key itself.
- `PATCH /api/user/youtube-key` — saves or clears (`""` → `null`) the key for the session user.
- If no key: routes return `{ error: "...", code: "NO_API_KEY" }` (HTTP 403). Frontend shows an amber CTA banner or a full-tab gate with a button to `/settings#youtube-key`.
- Error codes from YouTube API: `QUOTA_EXCEEDED` (HTTP 429), `INVALID_KEY` (HTTP 403) — displayed as plain error messages.
- `src/app/lib/youtube.ts` — shared helpers: `YT_API_BASE`, `parseIsoDuration`, `formatYtDuration`, `toUploadDate`, `parseYouTubeError`.
- Search flow: `search.list` (videoIds + thumbnails) + `videos.list` (duration, statistics, full snippet). Pagination uses YouTube's `nextPageToken` cursor (not offset-based pages).
- **Download/preview routes remain unchanged** — still use yt-dlp + ffmpeg. Only search and analyze moved to the YouTube API.
- Settings page (`/settings#youtube-key`) — masked password input, "Key saved" badge, Remove button, link to Google Cloud Console.

### Search — tags, history, pagination, metadata, blocked videos
- **Tags**: `SearchTag` model stores per-user keyword tags in DB. `GET/POST/PATCH/DELETE /api/tags`. Tags appear as filter pills in a dedicated "Tags" row. Clicking toggles them active (appended to the yt-dlp query). Hover reveals inline rename (pencil) and delete (✕). `+ New tag` dashed pill reveals an inline input; hidden by default.
- **History**: last 15 searches stored in `localStorage["search-history"]` as `SearchHistoryEntry[]` (rawInput, builtQuery, all filter state, timestamp). Shown below the search bar when idle. The currently active query is marked with a checkmark. Clicking an entry restores all filters.
- **Pagination**: `GET /api/search?q=…&pageToken=…` — cursor-based via YouTube API `nextPageToken`. Returns `{ results, nextPageToken, hasMore }`. Client stores `nextPageToken` state and sends it on "Load more". No artificial page cap — YouTube drives availability.
- **Search summary bar**: shows above results — result count (e.g. `"15+ beats"` while paginating, `"42 beats"` when done), spinning indicator while loading more, active query in italic, and color-coded filter badges for any active filters.
- **Video metadata on cards**: each result card shows uploader/channel, view count (formatted as `1.2M` / `450K`), upload date (e.g. `Mar 2024`), and a "Watch on YouTube" link. Extracted from yt-dlp JSON fields `view_count`, `uploader`/`channel`, `upload_date`.
- **Video cache**: every search result is upserted into `CachedVideo` (global, no user link) fire-and-forget after the response is sent. Stores `videoId`, `title`, `thumbnail`, `duration`, `durationSec`, `url`, `viewCount`, `uploader`, `uploadDate`, `updatedAt`. Allows persistent reference to any seen video regardless of yt-dlp availability.
- **Blocked videos**: "Never show" button on each result card. Calls `POST /api/banned`, adds to `bannedIds` Set (optimistic), hides video immediately from results. "Blocked" tab appears in nav when `bannedIds.size > 0`. Tab lists all blocked videos with thumbnail, title, uploader, ban date, and "Unblock" button (`DELETE /api/banned?videoId=xxx`). `BannedVideo` stored in DB, cascade-deleted with the user.

### Real-time collaboration
- Owner generates an `editToken` via `POST /api/notes/[videoId]/collab` — stored on the Note row (`editToken` column, unique).
- Invite link: `https://<host>/notes/[videoId]?collab=<editToken>`.
- Collaborators load the note via `GET /api/collab/[editToken]` (no ownership check — token is the credential).
- Socket.io server runs in `server.ts` alongside Next.js on the same port (`/socket.io` path).
- Auth: `io.use()` middleware reads the session cookie from the handshake headers and verifies the JWT.
- Rooms: keyed by `editToken`. In-memory `Map<editToken, RoomState>` holds live blocks/timecodes + a debounced (800 ms) DB save timer.
- Events: `join-room` → `room-state` + `peer-joined`; `blocks-update` / `timecodes-update` fan out to all peers; `disconnect` → `peer-left`, room cleaned up after 5 s if empty.
- Collaborators skip the REST save (`PUT /api/notes/[videoId]`) and push changes only via Socket.io.

---

## Docker / deployment

- `node:22-slim` base image — OpenSSL 3.x
- Prisma `binaryTargets`: `["native", "linux-arm64-openssl-3.0.x"]` — required for the container runtime
- **Do NOT copy `package-lock.json` into the Docker deps stage** — it was generated on macOS and locks macOS native binary paths (lightningcss etc.), causing build failures on Linux. The `deps` stage copies only `package.json` and runs `npm install` fresh.
- No `output: "standalone"` — full `node_modules` is copied into the runner stage instead.
- Container entrypoint: `prisma migrate deploy && npx tsx server.ts`
- `server.ts` (project root) — custom Node.js server that boots Next.js + Socket.io together. Dev: `tsx watch server.ts`; prod: `npx tsx server.ts`.
- `ffmpeg` installed via `apt-get` in the runner stage
- `yt-dlp` binaries: `bin/yt-dlp_linux` (x86_64) and `bin/yt-dlp_linux_aarch64` (ARM64). `getYtDlpPath()` in `src/app/lib/ytdlp.ts` selects by `process.arch`.

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
