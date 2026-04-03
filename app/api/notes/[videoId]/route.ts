import { type NextRequest } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getSession } from "@/app/lib/session";

type Ctx = { params: Promise<{ videoId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { videoId } = await params;

  const [favorite, note] = await Promise.all([
    prisma.favorite.findUnique({
      where: { userId_videoId: { userId: session.userId, videoId } },
    }),
    prisma.note.findUnique({
      where: { userId_videoId: { userId: session.userId, videoId } },
    }),
  ]);

  // Allow access if there's a note (even without a favorite)
  if (!favorite && !note) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ favorite, note });
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { videoId } = await params;
  const {
    blocks, timecodes,
    songName, isPublic, publicId,
    bpm, key, beatType,
    videoTitle, videoThumbnail, videoUrl,
  } = await request.json();

  const note = await prisma.note.upsert({
    where: { userId_videoId: { userId: session.userId, videoId } },
    create: {
      userId: session.userId,
      videoId,
      blocks,
      timecodes: timecodes ?? [],
      songName: songName ?? null,
      isPublic: isPublic ?? false,
      publicId: isPublic && publicId ? publicId : null,
      bpm: bpm ?? null,
      key: key ?? null,
      beatType: beatType ?? null,
      videoTitle: videoTitle ?? null,
      videoThumbnail: videoThumbnail ?? null,
      videoUrl: videoUrl ?? null,
    },
    update: {
      blocks,
      timecodes: timecodes ?? [],
      songName: songName ?? null,
      isPublic: isPublic ?? false,
      publicId: isPublic && publicId ? publicId : null,
      bpm: bpm ?? null,
      key: key ?? null,
      beatType: beatType ?? null,
      videoTitle: videoTitle ?? null,
      videoThumbnail: videoThumbnail ?? null,
      videoUrl: videoUrl ?? null,
    },
  });

  return Response.json({ note });
}
