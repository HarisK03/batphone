"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/app/lib/supabase-client";

type Call = {
  id: string;
  contactName: string | null;
  destinationPhone: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
  transcriptStatus: string;
};

function callUrl(id: string) {
  return `/calls/${id}`;
}

function formatTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString();
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "-";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function CallHistory() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = getSupabaseClient();
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        const res = await fetch("/api/calls", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setCalls(json.calls ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-2 mt-3">
      {loading && <p className="text-xs text-black">Loading calls...</p>}
      {!loading && calls.length === 0 && (
        <p className="text-xs text-black">No calls yet.</p>
      )}
      <ul className="divide-y">
        {calls.map((c) => (
          <li key={c.id} className="py-2 flex flex-col gap-1">
            <div className="flex justify-between items-center">
              <div className="flex flex-col">
                <a
                  href={callUrl(c.id)}
                  className="text-sm font-medium text-blue-600 underline"
                >
                  {c.contactName || c.destinationPhone || "Unknown"}
                </a>
                {c.destinationPhone && (
                  <span className="text-xs text-black">
                    {c.destinationPhone}
                  </span>
                )}
              </div>
              <span className="text-xs text-black">
                {formatDuration(c.durationSeconds)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-black">
                {formatTime(c.startedAt)}
              </span>
              <span className="text-[11px] text-black">
                {c.transcriptStatus === "completed"
                  ? "Transcript ready"
                  : c.transcriptStatus === "failed"
                  ? "Transcript failed"
                  : "Transcribing..."}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

