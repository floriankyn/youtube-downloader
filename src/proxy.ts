import { type NextRequest, NextResponse } from "next/server";
import { decrypt } from "@/app/lib/jwt";

export async function proxy(request: NextRequest) {
  const session = request.cookies.get("session")?.value;
  const payload = await decrypt(session);

  if (!payload?.userId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/search/:path*", "/api/favorites/:path*", "/api/notes/:path*", "/api/user/:path*"],
};
