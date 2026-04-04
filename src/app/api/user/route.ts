import { prisma } from "@/app/lib/prisma";
import { getSession, deleteSession } from "@/app/lib/session";

export async function DELETE() {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.user.delete({ where: { id: session.userId } });
  await deleteSession();

  return Response.json({ ok: true });
}
