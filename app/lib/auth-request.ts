import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "./supabase-service";

export function getAccessTokenFromRequest(request: Request) {
  const header = request.headers.get("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

async function getSupabaseUserFromToken(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const supabase = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  if (!data?.user) return null;
  return { id: data.user.id, email: data.user.email ?? null, name: data.user.user_metadata?.full_name ?? null };
}

export async function ensureUserFromRequest(request: Request) {
  const token = getAccessTokenFromRequest(request);
  if (!token) return null;

  const sbUser = await getSupabaseUserFromToken(token);
  if (!sbUser?.id) return null;

  const service = getSupabaseServiceClient();

  // Upsert a row in `public.users` for this PoC user.
  const fullName =
    sbUser.name ||
    undefined;

  const { error } = await service
    .from("users")
    .upsert(
      {
        id: sbUser.id,
        email: sbUser.email ?? "",
        name: fullName ?? null,
        phone_number: null,
      },
      { onConflict: "id" },
    );

  // Even if upsert fails (e.g. tables not created yet), return identity so UI can proceed.
  if (error) {
    return { id: sbUser.id, email: sbUser.email, name: fullName ?? null };
  }

  return { id: sbUser.id, email: sbUser.email, name: fullName ?? null };
}

