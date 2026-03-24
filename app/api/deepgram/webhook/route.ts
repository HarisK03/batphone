import { getSupabaseServiceClient } from "@/app/lib/supabase-service";
import { sendEmail } from "@/app/lib/email";
import { buildDeepgramLabeledTranscript } from "@/app/lib/transcription";

type DeepgramUtterance = {
	channel?: number;
	speaker?: number;
	transcript?: string;
	text?: string;
	start?: number;
	end?: number;
};

type DeepgramWebhookBody = {
	metadata?: {
		tags?: unknown;
		tag?: unknown;
	};
	results?: {
		utterances?: DeepgramUtterance[] | null;
	};
};

function escapeHtml(value: string) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function transcriptToHtml(transcriptText: string) {
	const lines = transcriptText.split("\n");
	return lines
		.map((line) => {
			const trimmed = line.trim();
			if (!trimmed) return "<br/>";
			const match = trimmed.match(/^([^:]+):\s*(.*)$/);
			if (!match) return escapeHtml(trimmed);
			const speaker = escapeHtml(match[1].trim());
			const content = escapeHtml(match[2].trim());
			return `<strong>${speaker}:</strong> ${content}`;
		})
		.join("<br/>");
}

function baseUrlFromRequest(request: Request) {
	const forwardedProto = request.headers.get("x-forwarded-proto");
	const forwardedHost = request.headers.get("x-forwarded-host");
	const host = forwardedHost || request.headers.get("host");

	if (host) {
		const proto = forwardedProto || (host.includes("localhost") ? "http" : "https");
		return `${proto}://${host}`;
	}

	// Fall back to env, but do not hardcode localhost.
	return process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "";
}

function extractCallId(body: unknown): string | null {
	const b = body as DeepgramWebhookBody | null;
	const tags = b?.metadata?.tags;
	if (Array.isArray(tags) && tags.length > 0 && typeof tags[0] === "string") {
		return tags[0].trim() || null;
	}
	if (typeof tags === "string" && tags.trim()) return tags.trim();

	// Fallbacks (not expected, but makes the webhook more tolerant)
	const tag = b?.metadata?.tag;
	if (Array.isArray(tag) && tag.length > 0 && typeof tag[0] === "string") {
		return tag[0].trim() || null;
	}
	if (typeof tag === "string" && tag.trim()) return tag.trim();

	return null;
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as DeepgramWebhookBody | null;
	if (!body) return new Response("ok", { status: 200 });

	const callbackCallId = new URL(request.url).searchParams.get("callId");
	const callId = callbackCallId?.trim() || extractCallId(body);
	if (!callId) {
		console.warn("[deepgram/webhook] Missing callId in callback payload/query");
		return new Response("ok", { status: 200 });
	}

	try {
		const supabase = getSupabaseServiceClient();

		const { data: call } = await supabase
			.from("calls")
			.select(
				"id,user_id,contact_name,destination_phone,started_at,duration_seconds,recording_url",
			)
			.eq("id", callId)
			.maybeSingle();

		if (!call) return new Response("ok", { status: 200 });

		const { data: user } = await supabase
			.from("users")
			.select("email,name,phone_number")
			.eq("id", call.user_id)
			.maybeSingle();

		if (!user?.email) return new Response("ok", { status: 200 });

		const rawUtterances = body.results?.utterances ?? [];
		const utterances = rawUtterances
			.map((u) => {
				const channel =
					u.channel != null && Number.isFinite(Number(u.channel))
						? Number(u.channel)
						: null;
				const speaker =
					u.speaker != null && Number.isFinite(Number(u.speaker))
						? Number(u.speaker)
						: null;
				const sideKey =
					channel != null
						? String(channel)
						: speaker != null
							? String(speaker)
							: "unknown";

				return {
					sideKey,
					text: (u.transcript ?? u.text ?? "").trim(),
					start: Number(u.start ?? 0),
					end: Number(u.end ?? 0),
				};
			})
			.filter((u) => u.text.length > 0);

		if (utterances.length === 0) {
			await supabase
				.from("calls")
				.update({
					transcript_status: "failed",
					transcript_error: "Deepgram returned no utterances.",
				})
				.eq("id", callId);
			return new Response("ok", { status: 200 });
		}

		const callerLabel =
			(user.name as string | null)?.trim() || (user.email as string) || "You";
		const contactLabel =
			(call.contact_name as string | null)?.trim() || "Contact";

		const transcriptText = buildDeepgramLabeledTranscript(
			utterances,
			callerLabel,
			contactLabel,
		);

		if (!transcriptText.trim()) {
			await supabase
				.from("calls")
				.update({
					transcript_status: "failed",
					transcript_error: "Deepgram produced an empty transcript.",
				})
				.eq("id", callId);
			return new Response("ok", { status: 200 });
		}

		await supabase
			.from("calls")
			.update({
				transcript_status: "completed",
				transcript_text: transcriptText,
				transcript_error: null,
			})
			.eq("id", callId);

		const appUrl = baseUrlFromRequest(request);
		const callerDisplay =
			(user.phone_number as string | null) ??
			(user.name as string | null) ??
			(user.email as string | null) ??
			"Unknown";
		const calledDisplay = (call.destination_phone as string | null) ?? "Unknown";

		const emailText = [
			"Call Transcript",
			"",
			`Caller Number: ${callerDisplay}`,
			`Called Number: ${calledDisplay}`,
			`Call Start Time: ${
				call.started_at
					? new Date(call.started_at as string).toISOString()
					: "Unknown"
			}`,
			`Call Duration: ${
				call.duration_seconds != null ? `${call.duration_seconds}s` : "Unknown"
			}`,
			"",
			transcriptText,
			"",
			...(appUrl
				? [
						`View in Bat Phone: ${appUrl}/calls/${call.id}`,
						`Recording: ${appUrl}/api/twilio/recording/download?recordingUrl=${encodeURIComponent(
							String(call.recording_url ?? ""),
						)}`,
					]
				: ["View in Bat Phone: unavailable", "Recording: unavailable"]),
		].join("\n");

		const viewUrl = appUrl ? `${appUrl}/calls/${call.id}` : "";
		const recordingUrl = appUrl
			? `${appUrl}/api/twilio/recording/download?recordingUrl=${encodeURIComponent(
					String(call.recording_url ?? ""),
				)}`
			: "";
		const emailHtml = `
			<div style="font-family: sans-serif; font-size: 14px; line-height: 1.5;">
				<h2 style="margin: 0 0 12px;">Call Transcript</h2>
				<p style="margin: 0 0 4px;"><strong>Caller Number:</strong> ${escapeHtml(callerDisplay)}</p>
				<p style="margin: 0 0 4px;"><strong>Called Number:</strong> ${escapeHtml(calledDisplay)}</p>
				<p style="margin: 0 0 4px;"><strong>Call Start Time:</strong> ${
					call.started_at
						? escapeHtml(new Date(call.started_at as string).toISOString())
						: "Unknown"
				}</p>
				<p style="margin: 0 0 12px;"><strong>Call Duration:</strong> ${
					call.duration_seconds != null
						? `${call.duration_seconds}s`
						: "Unknown"
				}</p>
				<div style="white-space: normal; margin: 0 0 12px;">
					${transcriptToHtml(transcriptText)}
				</div>
				<p style="margin: 0 0 4px;"><strong>View in Bat Phone:</strong> ${
					viewUrl ? `<a href="${escapeHtml(viewUrl)}">${escapeHtml(viewUrl)}</a>` : "unavailable"
				}</p>
				<p style="margin: 0;"><strong>Recording:</strong> ${
					recordingUrl
						? `<a href="${escapeHtml(recordingUrl)}">${escapeHtml(recordingUrl)}</a>`
						: "unavailable"
				}</p>
			</div>
		`;

		try {
			await sendEmail({
				to: user.email,
				subject: "Your Bat Phone call transcript",
				text: emailText,
				html: emailHtml,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await supabase
				.from("calls")
				.update({
					transcript_error: `Email delivery failed: ${message}`.slice(
						0,
						900,
					),
				})
				.eq("id", callId);
		}
	} catch {
		// Deepgram will retry callback if we don't return 2xx, so keep this tolerant.
		return new Response("ok", { status: 200 });
	}

	return new Response("ok", { status: 200 });
}

