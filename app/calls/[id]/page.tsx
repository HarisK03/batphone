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

type TranscriptErrorKind = "email" | "transcription" | "twilio" | "unknown";
type TranscriptErrorView = {
  kind: TranscriptErrorKind;
  title: string;
  description: string;
};

function renderTranscriptWithBoldSpeakers(transcriptText: string) {
  return transcriptText.split("\n").map((line, index) => {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) {
      return (
        <p key={index} className="whitespace-pre-wrap">
          {line}
        </p>
      );
    }

    return (
      <p key={index} className="whitespace-pre-wrap">
        <span className="font-semibold">{match[1]}:</span>{" "}
        <span>{match[2]}</span>
      </p>
    );
  });
}

function classifyTranscriptError(transcriptError: string): TranscriptErrorView {
  const err = transcriptError.trim();
  const lower = err.toLowerCase();

  if (lower.startsWith("email delivery failed:")) {
    return {
      kind: "email",
      title: "Email delivery failed",
      description:
        "The transcript is available in the app, but we couldn’t send it to your inbox.",
    };
  }

  if (lower.includes("missing twilio credentials") || lower.includes("recording download failed")) {
    return {
      kind: "twilio",
      title: "Recording unavailable",
      description:
        "We couldn’t access the call recording needed to generate the transcript. Please try again later.",
    };
  }

  if (
    lower.includes("deepgram") ||
    lower.includes("returned no utterances") ||
    lower.includes("produced an empty transcript") ||
    lower.includes("listen failed")
  ) {
    return {
      kind: "transcription",
      title: "Transcript unavailable",
      description:
        "We couldn’t generate a transcript for this call. Please try again later.",
    };
  }

  return {
    kind: "unknown",
    title: "Something went wrong",
    description: "We couldn’t complete transcript processing for this call. Please try again later.",
  };
}

export default function CallPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [call, setCall] = useState<CallView | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showTranscriptErrorDetails, setShowTranscriptErrorDetails] = useState(false);

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
        setShowTranscriptErrorDetails(false);
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
				<div className="flex flex-col items-center gap-3">
					<div
						className="w-8 h-8 rounded-full border-2 border-neutral-800 border-t-red-500 animate-spin"
						aria-hidden
					/>
					<span className="sr-only">Loading</span>
				</div>
      </div>
    );
  }

  if (!call) {
    return (
      <div className="min-h-screen flex items-center justify-center">
				<p className="text-sm text-neutral-200">Call not found.</p>
      </div>
    );
  }

  const transcriptTextAvailable = Boolean(
    call.transcriptText && call.transcriptText.trim().length > 0,
  );
  const isCompleted = call.transcriptStatus === "completed";
  const isFailed = call.transcriptStatus === "failed";
  const isPreparing = !isCompleted && !isFailed;
  const transcriptError = call.transcriptError ?? null;
  const transcriptErrorView = transcriptError
    ? classifyTranscriptError(transcriptError)
    : null;

  return (
    <div className="min-h-screen bg-neutral-950 px-4 py-6 text-neutral-100">
      <div className="max-w-md mx-auto bg-neutral-900 border border-neutral-800 rounded-2xl shadow-sm p-4 space-y-4">
				<h1 className="text-base font-semibold text-neutral-100">
					Call Transcript
				</h1>

				<div className="space-y-1 text-xs text-neutral-100/80">
					<p>
						<span className="font-semibold text-neutral-100">
							Destination:
						</span>{" "}
						{call.contactName ?? "Unknown"}
					</p>
					<p>
						<span className="font-semibold text-neutral-100">
							Phone:
						</span>{" "}
						{call.destinationPhone ?? "Unknown"}
					</p>
					<p>
						<span className="font-semibold text-neutral-100">
							Started:
						</span>{" "}
						{call.startedAt
							? new Date(call.startedAt).toLocaleString()
							: "Unknown"}
					</p>
					<p>
						<span className="font-semibold text-neutral-100">
							Duration:
						</span>{" "}
						{call.durationSeconds != null
							? `${call.durationSeconds}s`
							: "Unknown"}
					</p>
				</div>

				<div className="border-t border-neutral-800/60 pt-3 space-y-2">
					{isPreparing ? (
						<div className="rounded-xl border border-neutral-800/60 bg-neutral-900/30 p-3 space-y-1">
							<p className="text-xs font-semibold text-neutral-100">
								Transcript is being prepared
							</p>
							<p className="text-xs text-neutral-300/80">
								This usually takes about a minute after the call ends.
							</p>
						</div>
					) : isCompleted && transcriptTextAvailable ? (
						<div className="space-y-2">
							<div className="flex items-center justify-between gap-3">
								<p className="text-xs text-neutral-300/80">Transcript</p>
								<button
									type="button"
									onClick={async () => {
										try {
											await navigator.clipboard.writeText(
												call.transcriptText ?? "",
											);
											setCopied(true);
											setTimeout(() => setCopied(false), 1200);
										} catch {
											// If clipboard isn't available, do nothing.
										}
									}}
									className={[
										"text-xs rounded-xl px-3 py-1 transition-colors border",
										copied
											? "border-neutral-700/70 bg-neutral-900 text-neutral-100"
											: "border-neutral-800 text-neutral-200 hover:bg-neutral-900",
									].join(" ")}
								>
									{copied ? "Copied" : "Copy"}
								</button>
							</div>
							<div className="text-sm text-neutral-100 bg-neutral-950/30 rounded-xl border border-neutral-800/60 p-3 space-y-1">
								{renderTranscriptWithBoldSpeakers(
									call.transcriptText ?? "",
								)}
							</div>

							{transcriptErrorView?.kind === "email" && transcriptError ? (
								<div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 space-y-2">
									<div className="flex items-start justify-between gap-3">
										<div>
											<p className="text-xs font-semibold text-red-200">
												Email not delivered
											</p>
											<p className="text-xs text-red-200/80 mt-1">
												{transcriptErrorView.description}
											</p>
										</div>
										{transcriptError ? (
											<button
												type="button"
												onClick={() =>
													setShowTranscriptErrorDetails(
														(v) => !v,
													)
												}
												className="text-[11px] text-red-200/90 hover:text-red-200 transition-colors"
											>
												{showTranscriptErrorDetails
													? "Hide details"
													: "View details"}
											</button>
										) : null}
									</div>

									{showTranscriptErrorDetails ? (
										<pre className="whitespace-pre-wrap text-[11px] text-red-200 bg-neutral-950/30 rounded-xl border border-neutral-800/60 p-3">
											{transcriptError}
										</pre>
									) : null}
								</div>
							) : null}

							
						</div>
					) : (
						<div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 space-y-2">
							<p className="text-xs font-semibold text-red-200">
								{transcriptErrorView?.title ?? "Transcript unavailable"}
							</p>
							<p className="text-xs text-red-200/80">
								{transcriptErrorView?.description ??
									"Please try again later."}
							</p>

							{transcriptError ? (
								<>
									<button
										type="button"
										onClick={() =>
											setShowTranscriptErrorDetails(
												(v) => !v,
											)
										}
										className="text-[11px] text-red-200/90 hover:text-red-200 transition-colors"
									>
										{showTranscriptErrorDetails
											? "Hide details"
											: "View details"}
									</button>
									{showTranscriptErrorDetails ? (
										<pre className="whitespace-pre-wrap text-[11px] text-red-200 bg-neutral-950/30 rounded-xl border border-neutral-800/60 p-3">
											{transcriptError}
										</pre>
									) : null}
								</>
							) : null}
						</div>
					)}
				</div>

				{call.recordingUrl && (
					<a
						href={`/api/twilio/recording/download?recordingUrl=${encodeURIComponent(
							call.recordingUrl,
						)}`}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center justify-center text-xs text-red-500 underline hover:text-red-600 transition-colors"
					>
						Open recording
					</a>
				)}
      </div>
    </div>
  );
}

