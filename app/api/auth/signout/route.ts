import { createSupabaseServerClient } from "@/app/lib/supabase-server";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return Response.json({ ok: true });
}

