import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/prisma";

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { apiKey } = await req.json() as { apiKey: string };
  const value = typeof apiKey === "string" ? apiKey.trim() || null : null;

  await prisma.user.update({
    where: { id: session.userId },
    data: { youtubeApiKey: value },
  });

  return Response.json({ ok: true });
}
