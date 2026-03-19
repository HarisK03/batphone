"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/app/lib/supabase-client";

type SupabaseUser = { id: string; email?: string | null };

export function TopBar() {
  const [user, setUser] = useState<SupabaseUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseClient();

    async function load() {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        setUser(null);
        return;
      }
      setUser({ id: data.user.id, email: data.user.email });
    }

    load();

    const { data: listenerData } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session?.user) {
          setUser(null);
          return;
        }
        setUser({ id: session.user.id, email: session.user.email });
      },
    );

    return () => {
      cancelled = true;
      listenerData.subscription.unsubscribe();
    };
  }, []);

  return (
    <header className="w-full flex items-center justify-between px-4 py-3 border-b bg-white">
      <div className="flex flex-col">
        <span className="text-sm font-semibold text-black">Bat Phone</span>
        {user?.email && <span className="text-xs text-black">{user.email}</span>}
      </div>
      <button
        type="button"
        className="rounded-full bg-black text-white text-xs px-4 py-2"
        onClick={async () => {
          if (user) {
            await getSupabaseClient().auth.signOut();
            return;
          }

          const origin = window.location.origin;
          await getSupabaseClient().auth.signInWithOAuth({
            provider: "google",
            options: {
              redirectTo: `${origin}/auth/callback`,
            },
          });
        }}
      >
        {user ? "Sign out" : "Sign in with Google"}
      </button>
    </header>
  );
}

