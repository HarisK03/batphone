import { getSupabaseServiceClient } from "@/app/lib/supabase-service";
import { ensureUserFromRequest } from "@/app/lib/auth-request";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(request: Request) {
  const user = await ensureUserFromRequest(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("calls")
    .select(
      "id,contact_name,destination_phone,started_at,duration_seconds,transcript_status,transcript_text"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return new Response("Failed to load calls", { status: 500 });

  const rows = (data ?? []) as any[];
  const calls = rows.map((c) => ({
    id: c.id as string,
    contactName: c.contact_name as string | null,
    destinationPhone: c.destination_phone as string | null,
    startedAt: (c.started_at as string | null) ?? null,
    durationSeconds: (c.duration_seconds as number | null) ?? null,
    transcriptStatus: (c.transcript_status as string) ?? "pending",
  }));

  return Response.json({ calls });
}

