"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/app/lib/supabase-client";
import { FaPhone } from "react-icons/fa";

type Call = {
  id: string;
  contactName: string | null;
  destinationPhone: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
  transcriptStatus: string;
  transcriptError: string | null;
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
        if (!cancelled) {
          // Keep spinner visible a bit longer for smoother UX.
          await new Promise((r) => setTimeout(r, 1000));
          if (!cancelled) setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-2 mt-3 w-full">
      <p className="text-xs text-neutral-300/80">
        Tap a call to reveal the transcript.
      </p>
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div
            className="w-8 h-8 rounded-full border-2 border-neutral-800 border-t-red-500 animate-spin"
            aria-hidden
          />
          <span className="sr-only">Loading calls</span>
        </div>
      ) : (
        <>
          {calls.length === 0 && (
            <p className="text-xs text-neutral-300/80">No calls yet.</p>
          )}
          <ul className="divide-y divide-neutral-800/60">
            {calls.map((c) => (
              <li key={c.id} className="pt-2 pb-3 flex flex-col gap-1">
              <div className="flex justify-between items-center gap-3">
                  <div className="flex flex-col">
                    <a
                      href={callUrl(c.id)}
                      className="text-sm font-medium text-red-500 hover:text-red-600 transition-colors"
                    >
                      {c.contactName || c.destinationPhone || "Unknown"}
                    </a>
                    {c.destinationPhone && (
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-300/70">
                        <FaPhone size={13} aria-hidden />
                        <span>{c.destinationPhone}</span>
                      </div>
                    )}
                    {c.transcriptError && (
                      <div className="mt-1 text-[11px] text-neutral-300/70">
                        {c.transcriptError
                          .toLowerCase()
                          .startsWith("email delivery failed:") ? (
                          <span className="inline-flex items-center rounded-full border border-yellow-500/20 bg-yellow-500/5 px-2 py-0.5 text-yellow-200/90">
                            Email not sent
                          </span>
                        ) : c.transcriptStatus === "failed" ? (
                          <span className="inline-flex items-center rounded-full border border-red-500/20 bg-red-500/5 px-2 py-0.5 text-red-200/90">
                            Transcript unavailable
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-neutral-800/60 bg-neutral-900/30 px-2 py-0.5 text-neutral-200/80">
                            Transcript issue
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-neutral-100/80">
                      {formatDuration(c.durationSeconds)}
                    </div>
                    <div className="text-[11px] text-neutral-300">
                      {formatTime(c.startedAt)}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

