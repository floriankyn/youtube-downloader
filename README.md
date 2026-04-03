# Music Craftbook

A music production tool built around YouTube. Search for beats, preview them, download them, save favorites, and write lyrics with synced voice notes — all in one place.

---

## Features

### Search & Download

- **Paste a URL** — analyze any YouTube video to extract its title, BPM, key, genre, and artist references, then download as MP4, MP3, or WAV
- **Search YouTube** — find up to 15 results with smart search filters:
  - Date: Today, 1 week, 2 weeks, 1 month, 6 months, 1 year
  - Artist presets: Lil Peep, Juice WRLD
  - "Free" and "Type beat" toggles
- **Inline preview** — stream a preview directly in the browser before downloading
- **Beat metadata extraction** — automatically pulls BPM, musical key, beat type (trap, drill, lo-fi, phonk…), artist references, and hashtags from the video title, description, and comments

### Favorites

- Star any video to save it to your favorites
- Favorites store the search filters used to find them, so you can jump back to the same search with one click
- View all saved favorites in a dedicated tab

### Lyrics & Notes Editor

Each favorited video has a dedicated notes page (`/notes/[videoId]`) with a full editor:

- **Mixed blocks** — combine text sections and voice recordings freely
- **Auto-save** — changes are saved automatically with a 1.2s debounce
- **Section insertion** — add new text blocks anywhere in the editor
- **Delete blocks** — backspace on an empty text block removes it; voice notes have a hover-to-delete button

#### Beat Player

A sticky beat player lives in the header of the notes page:

- Play / pause / seek anywhere in the track
- Shows current time and total duration
- Download the beat as WAV directly from the notes page
- Lazy-loads the audio on first play

#### Voice Recording

Record voice notes directly inside the editor:

- Tap "Voice note" in any insert bar to record at that position
- Real-time elapsed timer while recording
- Tap again to stop and save — the note is inserted immediately
- Voice notes are stored as base64 in the database and play back with a progress bar

#### Voice Notes Synced to the Beat

Record a voice note at a specific moment in the beat:

- Tap **"+ beat"** in any insert bar
- A picker appears with:
  - A **timecode input** (type `1:30` or `90`)
  - **Arrow keys** (↑/↓) to step through the beat second by second
  - A **seek slider** from 0 to the full beat duration
  - A **preview button** to hear the beat at that exact position before recording — scrubbing the slider or changing the timecode live-seeks while previewing
  - A **−5s toggle** — when enabled, the beat starts 5 seconds before your chosen position so you have a lead-in
- Click **Record** to start — the beat plays from the chosen position and recording begins simultaneously
- Saved voice notes show a `@ 1:23` timecode badge
- On playback, choose:
  - **▶** — listen to the voice note alone
  - **▶ + beat** — play the voice note and beat together in sync from the saved position

#### Timecodes

Songs often have timestamps in their YouTube descriptions (`0:00 Intro`, `1:23 Verse 1`…). The notes page surfaces these as a visual timeline below the beat player:

- **Auto-detect** — click "Detect / Add" to import timecodes directly from the video's description. Timecodes are parsed and saved to your note automatically.
- **Manual edit** — add, edit, or delete any timecode. The time input accepts `MM:SS` format. The "Add at X" button inserts a new timecode at the beat's current playback position.
- **Interactive timeline** — a seekable bar with a live playhead shows where you are in the song. Labels highlight the active section as the beat plays. Click anywhere on the bar to seek.
- **Auto-tag on recording** — when you record a voice note while the beat is playing, the active section label (e.g. "Verse 1") is automatically attached to the voice note as a badge. Beat-synced recordings use the chosen beat position to find the section.

#### Audio Device Selection

A mic icon in the notes header opens a device settings panel:

- **Mic** — choose which input device to use for recording
- **Output** — route all audio (beat player + voice notes) to a specific speaker or headphone output
- Device labels load automatically after microphone permission is granted

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| Database | PostgreSQL via Prisma ORM |
| Auth | JWT (jose) + bcrypt, httpOnly cookies |
| YouTube | yt-dlp |
| Audio | ffmpeg-static |
| Infrastructure | Docker Compose |

---

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 20+

### Run with Docker

```bash
docker compose up --build
```

The app will be available at `http://localhost:3000`.

Docker Compose starts both a PostgreSQL instance and the Next.js app. Prisma migrations run automatically on container start.

### Run locally

```bash
# Install dependencies
npm install

# Set up your .env with a DATABASE_URL and JWT_SECRET
cp .env.example .env

# Run migrations
npx prisma migrate deploy

# Start dev server
npm run dev
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret key for session token signing |

---

## Data Models

**User** — email + hashed password, owns favorites and notes

**Favorite** — saved video with full beat metadata (BPM, key, type, artists, tags) and the search filters that were active when it was saved

**Note** — a JSON array of blocks (text or voice) tied to a user + video
