import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { createSession } from "@/app/lib/session";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const storedState = request.cookies.get("oauth_state")?.value;
  const appUrl = process.env.APP_URL!;

  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(`${appUrl}/?error=oauth_failed`);
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${appUrl}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error("No access token");

    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const googleUser = await userInfoRes.json();
    if (!googleUser.id || !googleUser.email) throw new Error("Missing user info");

    // Find by googleId first, then by email (to link existing accounts)
    let user = await prisma.user.findUnique({ where: { googleId: googleUser.id } });

    if (!user) {
      const byEmail = await prisma.user.findUnique({ where: { email: googleUser.email } });
      if (byEmail) {
        user = await prisma.user.update({
          where: { id: byEmail.id },
          data: { googleId: googleUser.id },
        });
      } else {
        user = await prisma.user.create({
          data: { email: googleUser.email, googleId: googleUser.id },
        });
      }
    }

    await createSession(user.id);

    const response = NextResponse.redirect(`${appUrl}/`);
    response.cookies.delete("oauth_state");
    return response;
  } catch {
    return NextResponse.redirect(`${appUrl}/?error=oauth_failed`);
  }
}
