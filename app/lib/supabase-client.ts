"use client";

import { createClient } from "@supabase/supabase-js";

let cached:
  | ReturnType<typeof createClient>
  | null = null;

export function getSupabaseClient() {
  if (cached) return cached;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required for Supabase auth.");
  }
  if (!supabaseAnonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required for Supabase auth.");
  }

  cached = createClient(supabaseUrl, supabaseAnonKey);
  return cached;
}

