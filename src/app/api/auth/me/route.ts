import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session?.userId) {
    return Response.json({ user: null });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, createdAt: true, passwordHash: true },
  });
  if (!user) return Response.json({ user: null });
  return Response.json({
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      hasPassword: !!user.passwordHash,
    },
  });
}
