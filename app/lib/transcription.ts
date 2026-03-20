import { getSupabaseServiceClient } from "./supabase-service";

const DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen";

function buildTwilioRecordingDownloadUrl(recordingUrl: string) {
	// Twilio dual-channel recordings are delivered in one audio file whose channels contain each side.
	// We request channels=2 so Deepgram can separate caller vs contact.
	const base = recordingUrl.replace(/\.(mp3|wav)$/i, "");
	return `${base}.mp3?RequestedChannels=2`;
}

type Utterance = {
	sideKey: string; // usually "0"/"1" for deepgram multichannel
	text: string;
	start: number;
	end: number;
};

function smartOrderBySide(utterances: Utterance[]): Utterance[] {
	if (utterances.length === 0) return [];

	// Group into per-side queues, each sorted by start time
	const sideMap = new Map<string, Utterance[]>();
	for (const utt of utterances) {
		const key = utt.sideKey;
		if (!sideMap.has(key)) sideMap.set(key, []);
		sideMap.get(key)!.push(utt);
	}

	// If only one side, just sort by time
	if (sideMap.size === 1) {
		return [...utterances].sort((a, b) => a.start - b.start);
	}

	for (const queue of sideMap.values()) {
		queue.sort((a, b) => a.start - b.start);
	}

	const keys = [...sideMap.keys()];
	// Pointers into each side's queue
	const ptrs = new Map<string, number>(keys.map((k) => [k, 0]));

	const result: Utterance[] = [];

	// In seconds: if the other side starts shortly after the current side ends,
	// treat it like a response turn (ping-pong conversation).
	const RESPONSE_WINDOW_S = 2;

	while (true) {
		const candidates = keys
			.map((k) => {
				const idx = ptrs.get(k)!;
				const queue = sideMap.get(k)!;
				return idx < queue.length ? { key: k, utt: queue[idx] } : null;
			})
			.filter(Boolean) as { key: string; utt: Utterance }[];

		if (candidates.length === 0) break;

		if (candidates.length === 1) {
			const { key, utt } = candidates[0];
			result.push(utt);
			ptrs.set(key, ptrs.get(key)! + 1);
			continue;
		}

		candidates.sort((a, b) => a.utt.start - b.utt.start);
		const first = candidates[0];
		const second = candidates[1];

		const lastPlaced = result[result.length - 1];
		const lastKey = lastPlaced ? lastPlaced.sideKey : null;

		if (lastKey === first.key) {
			const lastEnd = lastPlaced.end;
			const secondStartsAfterEnd = second.utt.start >= lastEnd;
			const secondStartsInWindow =
				second.utt.start <= lastEnd + RESPONSE_WINDOW_S;
			const secondStartsBeforeFirstNext =
				second.utt.start <= first.utt.start;

			if (
				(secondStartsAfterEnd && secondStartsInWindow) ||
				secondStartsBeforeFirstNext
			) {
				result.push(second.utt);
				ptrs.set(second.key, ptrs.get(second.key)! + 1);
				continue;
			}
		}

		result.push(first.utt);
		ptrs.set(first.key, ptrs.get(first.key)! + 1);
	}

	return result;
}

function determineCallerContactKeys(utterances: Utterance[]) {
	const numericSides = Array.from(
		new Set(
			utterances
				.map((u) => Number(u.sideKey))
				.filter((n) => Number.isFinite(n)),
		),
	).sort((a, b) => a - b);

	if (numericSides.length >= 2) {
		// Common patterns:
		// - deepgram multichannel often yields channel 0/1
		// - some pipelines yield 1/2
		if (numericSides.includes(0) && numericSides.includes(1)) {
			return { callerKey: "0", contactKey: "1" };
		}
		if (numericSides.includes(1) && numericSides.includes(2)) {
			return { callerKey: "1", contactKey: "2" };
		}

		// Fallback: smallest side is caller, next is contact.
		return {
			callerKey: String(numericSides[0]),
			contactKey: String(numericSides[1]),
		};
	}

	// Degenerate fallback (shouldn't happen with dual-channel)
	const only = numericSides[0];
	return { callerKey: String(only ?? 0), contactKey: String(only ?? 1) };
}

function buildLabeledTranscript(
	ordered: Utterance[],
	callerLabel: string,
	contactLabel: string,
	callerKey: string,
): string {
	if (ordered.length === 0) return "";

	const lines: string[] = [];
	let currentKey: string | null = null;
	let currentChunks: string[] = [];

	const flush = () => {
		if (currentChunks.length > 0 && currentKey !== null) {
			const label =
				currentKey === callerKey ? callerLabel : contactLabel;
			lines.push(`${label}: ${currentChunks.join(" ").trim()}`);
			currentChunks = [];
		}
	};

	for (const utt of ordered) {
		if (utt.sideKey !== currentKey) {
			flush();
			currentKey = utt.sideKey;
		}
		currentChunks.push(utt.text.trim());
	}
	flush();

	return lines.join("\n");
}

export function buildDeepgramLabeledTranscript(
	utterances: Array<{ sideKey: string; text: string; start: number; end: number }>,
	callerLabel: string,
	contactLabel: string,
): string {
	const { callerKey } = determineCallerContactKeys(utterances as Utterance[]);
	const ordered = smartOrderBySide(utterances as Utterance[]);
	return buildLabeledTranscript(
		ordered,
		callerLabel,
		contactLabel,
		callerKey,
	);
}

export async function transcribeAndEmailForCall(
	callId: string,
	appBaseUrl: string,
) {
	const supabase = getSupabaseServiceClient();

	const { data: call } = await supabase
		.from("calls")
		.select(
			"id,user_id,recording_url",
		)
		.eq("id", callId)
		.maybeSingle();

	if (!call?.user_id || !call.recording_url) return;

	const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
	if (!deepgramApiKey) {
		await supabase
			.from("calls")
			.update({
				transcript_status: "failed",
				transcript_error: "DEEPGRAM_API_KEY not set.",
			})
			.eq("id", callId);
		return;
	}

	const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
	const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
	if (!twilioAccountSid || !twilioAuthToken) {
		await supabase
			.from("calls")
			.update({
				transcript_status: "failed",
				transcript_error: "Missing Twilio credentials.",
			})
			.eq("id", callId);
		return;
	}

	await supabase
		.from("calls")
		.update({ transcript_status: "processing", transcript_error: null })
		.eq("id", callId);

	const recordingMediaUrl = buildTwilioRecordingDownloadUrl(
		call.recording_url as string,
	);

	const audioResp = await fetch(recordingMediaUrl, {
		headers: {
			authorization: `Basic ${Buffer.from(
				`${twilioAccountSid}:${twilioAuthToken}`,
			).toString("base64")}`,
		},
	});

	if (!audioResp.ok) {
		await supabase
			.from("calls")
			.update({
				transcript_status: "failed",
				transcript_error: `Recording download failed: ${audioResp.status}`,
			})
			.eq("id", callId);
		return;
	}

	const audioBytes = await audioResp.arrayBuffer();

	const url = new URL(DEEPGRAM_LISTEN_URL);
	// Phone-call friendly model + multichannel + diarization.
	url.searchParams.set("model", "nova-2-phonecall");
	url.searchParams.set("diarize", "true");
	url.searchParams.set("multichannel", "true");
	url.searchParams.set("utterances", "true");
	url.searchParams.set("smart_format", "true");
	url.searchParams.set("punctuate", "true");
	url.searchParams.set("language", "en");

	const callbackUrl = `${appBaseUrl}/api/deepgram/webhook`;
	url.searchParams.set("callback", callbackUrl);
	url.searchParams.set("callback_method", "post");
	// Deepgram will echo this back in metadata.tags so the webhook knows the call.
	url.searchParams.set("tag", callId);

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 120_000);

	try {
		const dgResp = await fetch(url.toString(), {
			method: "POST",
			headers: {
				Authorization: `Token ${deepgramApiKey}`,
				"Content-Type": "audio/mpeg",
			},
			body: audioBytes,
			signal: controller.signal,
		});

		if (!dgResp.ok) {
			const text = await dgResp.text().catch(() => "");
			await supabase
				.from("calls")
				.update({
					transcript_status: "failed",
					transcript_error: `Deepgram listen failed: ${dgResp.status} ${text}`.slice(
						0,
						900,
					),
				})
				.eq("id", callId);
			return;
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		await supabase
			.from("calls")
			.update({
				transcript_status: "failed",
				transcript_error: `Deepgram listen request failed: ${msg}`.slice(
					0,
					900,
				),
			})
			.eq("id", callId);
		return;
	} finally {
		clearTimeout(timeout);
	}
}
