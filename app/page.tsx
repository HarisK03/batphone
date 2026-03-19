"use client";

import { useEffect, useState } from "react";
import { TopBar } from "./components/TopBar";
import { PhoneSettings } from "./components/PhoneSettings";
import { ContactsPanel } from "./components/ContactsPanel";
import { CallHistory } from "./components/CallHistory";
import { CallBatPhone } from "./components/CallBatPhone";
import { getSupabaseClient } from "./lib/supabase-client";

type SupabaseUserLite = { id: string; email?: string | null };

export default function Home() {
  const [user, setUser] = useState<SupabaseUserLite | null>(null);

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
    <div className="min-h-screen flex flex-col bg-zinc-50">
      <TopBar />
      <main className="flex-1 w-full max-w-md mx-auto px-4 py-6 space-y-6">
        {!user && (
          <p className="text-sm text-black">
            Sign in with Google to configure your bat phone and contacts.
          </p>
        )}
        {user && (
          <div className="space-y-4">
            <section className="bg-white rounded-2xl shadow-sm p-4">
              <h2 className="text-sm font-semibold mb-2 text-black">
                1. Your phone number
              </h2>
              <p className="text-xs text-black">
                Configure the mobile number you will call the bat phone from.
              </p>
              <PhoneSettings />
            </section>
            <section className="bg-white rounded-2xl shadow-sm p-4">
              <h2 className="text-sm font-semibold mb-2 text-black">2. Contacts</h2>
              <p className="text-xs text-black">
                Add the people you want to reach via the bat phone.
              </p>
              <ContactsPanel />
            </section>
            <section className="bg-white rounded-2xl shadow-sm p-4">
              <h2 className="text-sm font-semibold mb-2 text-black">3. Call history</h2>
              <p className="text-xs text-black">
                Recently completed calls and transcripts.
              </p>
              <CallHistory />
            </section>
            <section className="bg-white rounded-2xl shadow-sm p-4">
              <h2 className="text-sm font-semibold mb-2 text-black">
                4. Call Bat Phone
              </h2>
              <CallBatPhone />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
