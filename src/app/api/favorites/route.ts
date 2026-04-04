import { type NextRequest } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getSession } from "@/app/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session?.userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const favorites = await prisma.favorite.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({ favorites });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json();
  const {
    videoId, title, thumbnail, duration, durationSec, url,
    bpm, key, beatType, inspiredBy, tags,
    dateFilter, freeFilter, artistFilter, typeBeat,
  } = body;

  if (!videoId || !title || !url) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const favorite = await prisma.favorite.upsert({
    where: { userId_videoId: { userId: session.userId, videoId } },
    create: {
      userId: session.userId,
      videoId,
      title,
      thumbnail: thumbnail ?? "",
      duration: duration ?? "",
      durationSec: durationSec ?? 0,
      url,
      bpm: bpm ?? null,
      key: key ?? null,
      beatType: beatType ?? null,
      inspiredBy: inspiredBy ?? [],
      tags: tags ?? [],
      dateFilter: dateFilter ?? null,
      freeFilter: freeFilter ?? false,
      artistFilter: artistFilter ?? null,
      typeBeat: typeBeat ?? false,
    },
    update: {},
  });

  return Response.json({ favorite });
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session?.userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { videoId, bpm, key, beatType, inspiredBy, tags } = await request.json();
  if (!videoId) {
    return Response.json({ error: "Missing videoId" }, { status: 400 });
  }

  const favorite = await prisma.favorite.update({
    where: { userId_videoId: { userId: session.userId, videoId } },
    data: {
      bpm: bpm ?? null,
      key: key ?? null,
      beatType: beatType ?? null,
      inspiredBy: inspiredBy ?? [],
      tags: tags ?? [],
    },
  });

  return Response.json({ favorite });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session?.userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const videoId = request.nextUrl.searchParams.get("videoId");
  if (!videoId) {
    return Response.json({ error: "Missing videoId" }, { status: 400 });
  }

  await prisma.favorite.deleteMany({
    where: { userId: session.userId, videoId },
  });

  return Response.json({ ok: true });
}
