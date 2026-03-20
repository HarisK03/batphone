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

	const callId = extractCallId(body);
	if (!callId) return new Response("ok", { status: 200 });

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
			.select("email,name")
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

		const emailText = [
			"Call Transcript",
			"",
			`Caller: ${user.name ?? user.email}`,
			`Destination: ${(call.destination_phone as string | null) ?? "Unknown"}`,
			`Phone Number: ${(call.destination_phone as string | null) ?? "Unknown"}`,
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

		try {
			await sendEmail({
				to: user.email,
				subject: "Your Bat Phone call transcript",
				text: emailText,
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

