import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { Server } from "socket.io";
import { decrypt } from "./src/app/lib/jwt";
import { prisma } from "./src/app/lib/prisma";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port, dir: process.cwd() });
const handle = app.getRequestHandler();

// ─── Room state ───────────────────────────────────────────────

interface RoomState {
  ownerUserId: string;
  videoId: string;
  blocks: unknown;
  timecodes: unknown;
  saveTimer: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, RoomState>();

function scheduleSave(editToken: string) {
  const room = rooms.get(editToken);
  if (!room) return;
  if (room.saveTimer) clearTimeout(room.saveTimer);
  room.saveTimer = setTimeout(async () => {
    try {
      await prisma.note.update({
        where: { userId_videoId: { userId: room.ownerUserId, videoId: room.videoId } },
        data: { blocks: room.blocks as never, timecodes: room.timecodes as never },
      });
    } catch (err) { console.error("[collab] save error:", err); }
    room.saveTimer = null;
  }, 800);
}

// ─── Cookie parser ────────────────────────────────────────────

function parseCookies(header: string): Record<string, string> {
  return header.split(";").reduce((acc, pair) => {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) return acc;
    const key = pair.slice(0, eqIdx).trim();
    const val = pair.slice(eqIdx + 1).trim();
    acc[key] = val;
    return acc;
  }, {} as Record<string, string>);
}

// ─── Boot ─────────────────────────────────────────────────────

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer, {
    cors: {
      origin: process.env.APP_URL || "http://localhost:3000",
      credentials: true,
    },
    path: "/socket.io",
  });

  // ── Auth middleware ─────────────────────────────────────────
  io.use(async (socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie || "";
    console.log("[collab] handshake cookie header:", cookieHeader ? cookieHeader.substring(0, 120) : "(empty)");
    const cookies = parseCookies(cookieHeader);
    console.log("[collab] parsed cookie keys:", Object.keys(cookies));
    const session = await decrypt(cookies["session"]);
    if (!session?.userId) {
      console.log("[collab] auth failed — no valid session cookie");
      return next(new Error("Unauthorized"));
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, email: true },
    });
    if (!user) {
      console.log("[collab] auth failed — user not found:", session.userId);
      return next(new Error("Unauthorized"));
    }

    socket.data.userId = user.id;
    socket.data.email = user.email;
    console.log(`[collab] socket authenticated: ${user.email} (${socket.id})`);
    next();
  });

  // ── Connection handler ──────────────────────────────────────
  io.on("connection", (socket) => {
    let currentRoom: string | null = null;

    socket.on("join-room", async (editToken: string) => {
      if (typeof editToken !== "string" || editToken.length > 200) {
        console.log("[collab] join-room rejected — invalid token format");
        return;
      }

      let note;
      try {
        note = await prisma.note.findUnique({
          where: { editToken },
          select: { userId: true, videoId: true, blocks: true, timecodes: true },
        });
      } catch (err) {
        console.error("[collab] DB error in join-room:", err);
        socket.emit("error", { message: "Server error" });
        return;
      }

      if (!note) {
        console.log(`[collab] join-room failed — token not found: ${editToken.slice(0, 8)}…`);
        socket.emit("error", { message: "Invalid collaboration token" });
        return;
      }

      currentRoom = editToken;
      socket.join(editToken);

      if (!rooms.has(editToken)) {
        rooms.set(editToken, {
          ownerUserId: note.userId,
          videoId: note.videoId,
          blocks: note.blocks ?? [],
          timecodes: note.timecodes ?? [],
          saveTimer: null,
        });
        console.log(`[collab] room created: ${editToken.slice(0, 8)}… videoId=${note.videoId}`);
      }

      const room = rooms.get(editToken)!;
      const socketsInRoom = await io.in(editToken).fetchSockets();
      const peers = socketsInRoom
        .filter((s) => s.id !== socket.id)
        .map((s) => ({ id: s.id, email: s.data.email as string }));

      console.log(`[collab] ${socket.data.email} joined room ${editToken.slice(0, 8)}… peers=${peers.length}`);

      socket.emit("room-state", {
        blocks: room.blocks,
        timecodes: room.timecodes,
        peers,
      });

      socket.to(editToken).emit("peer-joined", {
        id: socket.id,
        email: socket.data.email as string,
      });
    });

    socket.on("blocks-update", (blocks: unknown) => {
      if (!currentRoom) {
        console.log(`[collab] blocks-update from ${socket.id} but not in a room yet — dropped`);
        return;
      }
      const room = rooms.get(currentRoom);
      if (!room) return;
      room.blocks = blocks;
      scheduleSave(currentRoom);
      socket.to(currentRoom).emit("blocks-update", { blocks, fromPeerId: socket.id });
    });

    socket.on("timecodes-update", (timecodes: unknown) => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      if (!room) return;
      room.timecodes = timecodes;
      scheduleSave(currentRoom);
      socket.to(currentRoom).emit("timecodes-update", { timecodes, fromPeerId: socket.id });
    });

    socket.on("disconnect", () => {
      console.log(`[collab] ${socket.data.email ?? socket.id} disconnected`);
      if (!currentRoom) return;
      socket.to(currentRoom).emit("peer-left", { id: socket.id });

      // Clean up room if empty
      setTimeout(async () => {
        const sockets = await io.in(currentRoom!).fetchSockets();
        if (sockets.length === 0) {
          const room = rooms.get(currentRoom!);
          if (room?.saveTimer) clearTimeout(room.saveTimer);
          rooms.delete(currentRoom!);
          console.log(`[collab] room ${currentRoom!.slice(0, 8)}… cleaned up`);
        }
      }, 5000);
    });
  });

  httpServer.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
