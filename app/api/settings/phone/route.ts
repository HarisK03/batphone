import { getSupabaseServiceClient } from "@/app/lib/supabase-service";
import { z } from "zod";
import { ensureUserFromRequest } from "@/app/lib/auth-request";
import { normalizePhoneNumber } from "@/app/lib/phone";

const bodySchema = z.object({
  phoneNumber: z.string().min(3).max(64),
  name: z.string().min(1).max(80).optional(),
});

export async function GET(request: Request) {
  // Auth via client access token (cookies aren't required for this PoC).
  const user = await ensureUserFromRequest(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("users")
    .select("phone_number,name")
    .eq("id", user.id)
    .maybeSingle();

  if (error) return new Response("Failed to load phone number", { status: 500 });

  return Response.json({
    phoneNumber: data?.phone_number ?? "",
    name: data?.name ?? null,
  });
}

export async function POST(request: Request) {
  const user = await ensureUserFromRequest(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return new Response("Invalid payload", { status: 400 });
  }

  const normalizedPhone = normalizePhoneNumber(parsed.data.phoneNumber);
  if (!normalizedPhone) {
    return new Response("Invalid phone number", { status: 400 });
  }

  const supabase = getSupabaseServiceClient();

  // Enforce uniqueness: phone numbers can only belong to one user.
  const { data: existingRows } = await supabase
    .from("users")
    .select("id")
    .eq("phone_number", normalizedPhone)
    .neq("id", user.id)
    .limit(1);

  if ((existingRows ?? []).length > 0) {
    return new Response("Phone number already in use", { status: 409 });
  }

  const { error } = await supabase
    .from("users")
    .update({
      phone_number: normalizedPhone,
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
    })
    .eq("id", user.id);

  if (error) return new Response("Failed to save phone number", { status: 500 });

  return Response.json({ ok: true });
}

