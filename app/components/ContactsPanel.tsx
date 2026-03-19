"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/app/lib/supabase-client";

type Contact = {
  id: string;
  name: string;
  phoneNumber: string;
};

export function ContactsPanel() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = getSupabaseClient();
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        const res = await fetch("/api/contacts", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setContacts(json.contacts ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function addContact(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !phone) return;
    setSaving(true);
    try {
      const supabase = getSupabaseClient();
      const { data: sd } = await supabase.auth.getSession();
      const token = sd.session?.access_token;
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name, phoneNumber: phone }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setContacts((prev) => [...prev, data.contact]);
      setName("");
      setPhone("");
    } finally {
      setSaving(false);
    }
  }

  async function removeContact(id: string) {
    const prev = contacts;
    setContacts((c) => c.filter((x) => x.id !== id));
    const supabase = getSupabaseClient();
    const { data: sd } = await supabase.auth.getSession();
    const token = sd.session?.access_token;

    const res = await fetch(`/api/contacts?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      setContacts(prev);
    }
  }

  return (
    <div className="space-y-3 mt-3">
      <form onSubmit={addContact} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-full border px-3 py-2 text-sm"
            style={{ color: "#000" }}
            placeholder="Name (Mike Anderson)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
          />
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-full border px-3 py-2 text-sm"
            style={{ color: "#000" }}
            placeholder="+1 555 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={saving}
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-black text-white text-xs px-4 py-2 disabled:opacity-50"
          >
            {saving ? "Adding..." : "Add"}
          </button>
        </div>
      </form>

      <div className="max-h-52 overflow-y-auto">
        {loading && (
          <p className="text-xs text-black">Loading contacts...</p>
        )}
        {!loading && contacts.length === 0 && (
          <p className="text-xs text-black">No contacts yet.</p>
        )}
        <ul className="divide-y">
          {contacts.map((c) => (
            <li key={c.id} className="py-2 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-black">{c.name}</p>
                <p className="text-xs text-black">{c.phoneNumber}</p>
              </div>
              <button
                type="button"
                className="text-xs text-red-500"
                onClick={() => removeContact(c.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

