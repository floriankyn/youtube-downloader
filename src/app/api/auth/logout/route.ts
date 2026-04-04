import { deleteSession } from "@/app/lib/session";

export async function POST() {
  await deleteSession();
  return Response.json({ ok: true });
}
