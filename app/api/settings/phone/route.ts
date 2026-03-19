import { getSupabaseServiceClient } from "@/app/lib/supabase-service";
import { z } from "zod";
import { ensureUserFromRequest } from "@/app/lib/auth-request";

const bodySchema = z.object({
  phoneNumber: z.string().min(5).max(32),
});

export async function GET(request: Request) {
  // Auth via client access token (cookies aren't required for this PoC).
  const user = await ensureUserFromRequest(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("users")
    .select("phone_number")
    .eq("id", user.id)
    .maybeSingle();

  if (error) return new Response("Failed to load phone number", { status: 500 });

  return Response.json({ phoneNumber: data?.phone_number ?? "" });
}

export async function POST(request: Request) {
  const user = await ensureUserFromRequest(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new Response("Invalid phone number", { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("users")
    .update({ phone_number: parsed.data.phoneNumber })
    .eq("id", user.id);

  if (error) return new Response("Failed to save phone number", { status: 500 });

  return Response.json({ ok: true });
}

