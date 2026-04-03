import { prisma } from "@/app/lib/prisma";
import { getSession } from "@/app/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session?.userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const notes = await prisma.note.findMany({
    where: {
      userId: session.userId,
      songName: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      videoId: true,
      songName: true,
      isPublic: true,
      publicId: true,
      bpm: true,
      key: true,
      beatType: true,
      videoTitle: true,
      videoThumbnail: true,
      updatedAt: true,
    },
  });

  return Response.json({ songs: notes });
}
