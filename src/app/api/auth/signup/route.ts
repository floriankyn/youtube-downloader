import { prisma } from "@/app/lib/prisma";
import { createSession } from "@/app/lib/session";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
  const body = await request.json();
  const { email, password } = body;

  if (!email || !password || password.length < 8) {
    return Response.json(
      { error: "Email required and password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return Response.json(
      { error: "Email already registered" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash },
  });

  await createSession(user.id);

  return Response.json({ ok: true });
}
