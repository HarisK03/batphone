import { getSupabaseServiceClient } from "@/app/lib/supabase-service";
import { ensureUserFromRequest } from "@/app/lib/auth-request";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(
  req: Request,
  ctx: RouteContext<"/api/calls/[id]">,
) {
  const user = await ensureUserFromRequest(req);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("calls")
    .select(
      "id,contact_name,destination_phone,started_at,ended_at,duration_seconds,status,recording_sid,recording_url,transcript_text,transcript_status,transcript_error"
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return new Response("Failed to load call", { status: 500 });
  if (!data) return new Response("Not found", { status: 404 });

  const d = data as any;
  const call = {
    id: d.id as string,
    contactName: (d.contact_name as string | null) ?? null,
    destinationPhone: (d.destination_phone as string | null) ?? null,
    startedAt: (d.started_at as string | null) ?? null,
    durationSeconds: (d.duration_seconds as number | null) ?? null,
    transcriptStatus: (d.transcript_status as string) ?? "pending",
    transcriptError: (d.transcript_error as string | null) ?? null,
    transcriptText: (d.transcript_text as string | null) ?? null,
    recordingUrl: (d.recording_url as string | null) ?? null,
  };

  return Response.json({ call });
}

