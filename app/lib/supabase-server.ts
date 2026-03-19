import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "./supabase-service";

type SupabaseUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase env vars (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY) are missing.");
  }

  const store = cookieStore as unknown as {
    get?: (name: string) => { value?: string } | undefined;
    set?: (name: string, value: string, options: Record<string, unknown>) => void;
    delete?: (name: string) => void;
  };

  return createServerClient(
    url,
    anonKey,
    {
      cookies: {
        // Use deprecated get/set/remove instead of getAll/setAll.
        // This avoids Next.js runtime differences where `getAll()` is unavailable.
        get(name: string) {
          const c = store.get?.(name);
          return c?.value ?? null;
        },
        set(name: string, value: string, options: Record<string, unknown>) {
          if (typeof store.set === "function") {
            console.log("[supabase][cookies] set:", name);
            store.set(name, value, options);
          }
        },
        remove(name: string, _options: Record<string, unknown>) {
          void _options;
          if (typeof store.delete === "function") {
            console.log("[supabase][cookies] remove:", name);
            store.delete(name);
          }
        },
      },
    },
  );
}

export async function getSupabaseUser(): Promise<SupabaseUser | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  if (!data?.user) return null;
  return data.user as SupabaseUser;
}

function deriveName(user: SupabaseUser) {
  const md = user.user_metadata ?? {};
  const given = typeof md.given_name === "string" ? md.given_name : null;
  const family = typeof md.family_name === "string" ? md.family_name : null;
  if (given && family) return `${given} ${family}`;
  if (typeof md.full_name === "string") return md.full_name;
  return null;
}

export async function ensureBatPhoneUser() {
  const sbUser = await getSupabaseUser();
  if (!sbUser?.id) return null;

  const name = deriveName(sbUser);
  const email = sbUser.email ?? "";

  let supabase;
  try {
    supabase = getSupabaseServiceClient();
  } catch {
    // If the service role key isn't configured yet, still allow the UI to
    // recognize you as logged in. DB writes (phone/contacts) will fail later.
    return { id: sbUser.id, email, name };
  }

  const { data, error } = await supabase
    .from("users")
    .upsert(
      {
        id: sbUser.id,
        email,
        name,
        phone_number: null,
      },
      { onConflict: "id" },
    )
    .select("id,email,name,phone_number")
    .maybeSingle();

  if (error) return null;
  return {
    id: data?.id ?? sbUser.id,
    email: data?.email ?? email,
    name: data?.name ?? name,
  };
}

