import bcrypt from "bcryptjs";
import { prisma } from "@/app/lib/prisma";
import { getSession } from "@/app/lib/session";

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session?.userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { email, password } = await request.json();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "A valid email is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) return Response.json({ error: "User not found" }, { status: 404 });

  if (user.passwordHash) {
    if (!password) return Response.json({ error: "Password confirmation required" }, { status: 400 });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return Response.json({ error: "Incorrect password" }, { status: 401 });
  }

  const conflict = await prisma.user.findUnique({ where: { email } });
  if (conflict && conflict.id !== session.userId) {
    return Response.json({ error: "Email already in use" }, { status: 409 });
  }

  await prisma.user.update({ where: { id: session.userId }, data: { email } });
  return Response.json({ ok: true });
}
