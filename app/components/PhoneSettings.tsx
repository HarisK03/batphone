"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/app/lib/supabase-client";

export function PhoneSettings() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = getSupabaseClient();
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        const res = await fetch("/api/settings/phone", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) {
          setPhoneNumber(json.phoneNumber ?? "");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const supabase = getSupabaseClient();
      const { data: sd } = await supabase.auth.getSession();
      const token = sd.session?.access_token;
      const res = await fetch("/api/settings/phone", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ phoneNumber }),
      });
      if (!res.ok) {
        setMessage("Failed to save phone number.");
      } else {
        setMessage("Phone number saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 mt-3">
      <div className="flex items-center gap-2">
        <input
          type="tel"
          inputMode="tel"
          className="flex-1 rounded-full border px-3 py-2 text-sm"
          style={{ color: "#000" }}
          placeholder="+1 555 123 4567"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          disabled={loading || saving}
        />
        <button
          type="submit"
          disabled={loading || saving}
          className="rounded-full bg-black text-white text-xs px-4 py-2 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
      {message && <p className="text-[11px] text-black">{message}</p>}
    </form>
  );
}

