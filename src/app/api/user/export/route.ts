import { prisma } from "@/app/lib/prisma";
import { getSession } from "@/app/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { favorites: true, notes: true },
  });
  if (!user) return Response.json({ error: "User not found" }, { status: 404 });

  const exportData = {
    account: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
    },
    favorites: user.favorites,
    notes: user.notes,
    exportedAt: new Date().toISOString(),
  };

  const date = new Date().toISOString().split("T")[0];
  return new Response(JSON.stringify(exportData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="musiccraftbook-export-${date}.json"`,
    },
  });
}
