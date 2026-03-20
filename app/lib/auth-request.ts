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

  const upsertPayload: {
    id: string;
    email: string;
    name?: string | null;
  } = {
    id: sbUser.id,
    email: sbUser.email ?? "",
  };

  // Important: don't overwrite a user-edited `users.name` on every request.
  // We only backfill `name` from OAuth when the DB value is currently empty.
  try {
    const { data: existing, error: existingError } = await service
      .from("users")
      .select("name")
      .eq("id", sbUser.id)
      .maybeSingle();

    const existingName = existing?.name;
    const shouldBackfillName = Boolean(fullName) && (!existingName || existingName === "");

    if (shouldBackfillName) {
      upsertPayload.name = fullName!;
    }

    if (existingError) {
      // If we can't read current state, fall back to previous behavior of not overwriting.
      // (We still upsert id/email so the UI can proceed.)
      void existingError;
    }
  } catch {
    // If the read fails, avoid overwriting name.
  }

  const { error } = await service
    .from("users")
    .upsert(
      upsertPayload,
      { onConflict: "id" },
    );

  // Even if upsert fails (e.g. tables not created yet), return identity so UI can proceed.
  if (error) {
    return { id: sbUser.id, email: sbUser.email, name: fullName ?? null };
  }

  return { id: sbUser.id, email: sbUser.email, name: fullName ?? null };
}

