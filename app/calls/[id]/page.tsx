"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabaseClient } from "@/app/lib/supabase-client";

type CallView = {
  contactName: string | null;
  destinationPhone: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
  transcriptStatus: string;
  transcriptError: string | null;
  transcriptText: string | null;
  recordingUrl: string | null;
};

export default function CallPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [call, setCall] = useState<CallView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!id) return;
      setLoading(true);

      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      const res = await fetch(`/api/calls/${encodeURIComponent(id)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (cancelled) return;
      if (res.ok) {
        const json = await res.json();
        setCall(json.call ?? null);
      } else {
        setCall(null);
      }
      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-black">Loading…</p>
      </div>
    );
  }

  if (!call) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-black">Call not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-6">
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-sm p-4 space-y-4">
        <h1 className="text-lg font-semibold">Call Transcript</h1>
        <div className="text-xs text-black space-y-1">
          <p>
            <span className="font-semibold">Destination:</span>{" "}
            {call.contactName ?? "Unknown"}
          </p>
          <p>
            <span className="font-semibold">Phone:</span>{" "}
            {call.destinationPhone ?? "Unknown"}
          </p>
          <p>
            <span className="font-semibold">Started:</span>{" "}
            {call.startedAt ? new Date(call.startedAt).toLocaleString() : "Unknown"}
          </p>
          <p>
            <span className="font-semibold">Duration:</span>{" "}
            {call.durationSeconds != null ? `${call.durationSeconds}s` : "Unknown"}
          </p>
        </div>
        <div className="border-t pt-3">
          {call.transcriptStatus !== "completed" && (
            <p className="text-xs text-black">
              Transcript status: {call.transcriptStatus}
              {call.transcriptError
                ? ` (${call.transcriptError})`
                : ". This may take a minute after the call ends."}
            </p>
          )}
          {call.transcriptStatus === "completed" && call.transcriptText && (
            <pre className="whitespace-pre-wrap text-sm text-zinc-800">
              {call.transcriptText}
            </pre>
          )}
        </div>
        {call.recordingUrl && (
          <a
            href={call.recordingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 underline"
          >
            Open recording
          </a>
        )}
      </div>
    </div>
  );
}

