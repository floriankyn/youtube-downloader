import { type NextRequest } from "next/server";
import { prisma } from "@/app/lib/prisma";

type Ctx = { params: Promise<{ publicId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { publicId } = await params;

  const note = await prisma.note.findUnique({
    where: { publicId, isPublic: true },
    select: {
      videoId: true,
      songName: true,
      bpm: true,
      key: true,
      beatType: true,
      videoTitle: true,
      videoThumbnail: true,
      videoUrl: true,
      blocks: true,
      timecodes: true,
    },
  });

  if (!note) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ note });
}
