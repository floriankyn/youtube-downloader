import { prisma } from "@/app/lib/prisma";
import { createSession } from "@/app/lib/session";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
  const body = await request.json();
  const { email, password } = body;

  if (!email || !password) {
    return Response.json({ error: "Missing credentials" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    return Response.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }

  await createSession(user.id);

  return Response.json({ ok: true });
}
