import { getSupabaseServiceClient } from "@/app/lib/supabase-service";

/* eslint-disable @typescript-eslint/no-explicit-any */

function xml(body: string) {
	return new Response(body, {
		status: 200,
		headers: { "Content-Type": "text/xml" },
	});
}

function baseUrlFromRequest(request: Request) {
	const forwardedProto = request.headers.get("x-forwarded-proto");
	const forwardedHost = request.headers.get("x-forwarded-host");
	const host = forwardedHost || request.headers.get("host");

	if (host) {
		const proto =
			forwardedProto || (host.includes("localhost") ? "http" : "https");
		return `${proto}://${host}`;
	}

	return process.env.AUTH_URL || "";
}

function normalize(text: string) {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function escape(text: string) {
	return text.replace(/[<>&'"]/g, " ").trim();
}

// 🔹 Smart token matching
function matchesName(contactName: string, query: string) {
	const nameTokens = normalize(contactName).split(" ");
	const queryTokens = normalize(query).split(" ");

	return queryTokens.every((q) => nameTokens.some((n) => n.startsWith(q)));
}

// 🔹 Levenshtein
function levenshtein(a: string, b: string): number {
	const dp = Array.from({ length: a.length + 1 }, () =>
		new Array(b.length + 1).fill(0),
	);

	for (let i = 0; i <= a.length; i++) dp[i][0] = i;
	for (let j = 0; j <= b.length; j++) dp[0][j] = j;

	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			dp[i][j] = Math.min(
				dp[i - 1][j] + 1,
				dp[i][j - 1] + 1,
				dp[i - 1][j - 1] + cost,
			);
		}
	}

	return dp[a.length][b.length];
}

function similarity(a: string, b: string) {
	const maxLen = Math.max(a.length, b.length);
	if (maxLen === 0) return 1;
	return 1 - levenshtein(a, b) / maxLen;
}

const speechMap: Record<string, number> = {
	one: 1,
	two: 2,
	three: 3,
};

export async function POST(request: Request) {
	const requestUrl = new URL(request.url);

	const retryCount = Number(requestUrl.searchParams.get("retry") ?? "0");
	const choicePhonesParam = requestUrl.searchParams.get("choicePhones") ?? "";

	const form = await request.formData();

	const callSid = (form.get("CallSid") ?? "").toString();
	const speechResult = (form.get("SpeechResult") ?? "").toString();
	const digits = (form.get("Digits") ?? "").toString();

	console.log("[COLLECT]", { callSid, speechResult, digits, retryCount });

	const query = (speechResult || digits).trim();
	const baseUrl = baseUrlFromRequest(request);

	const supabase = getSupabaseServiceClient();

	const { data: call } = await supabase
		.from("calls")
		.select("id,user_id")
		.eq("twilio_call_sid", callSid)
		.maybeSingle();

	if (!call) {
		return xml(
			`<Response><Say>Sorry, something went wrong. Please try again.</Say><Hangup/></Response>`,
		);
	}

	const { data: contacts } = await supabase
		.from("contacts")
		.select("id,name,phone_number")
		.eq("user_id", call.user_id);

	const contactRows = contacts ?? [];

	// ───────────── DISAMBIGUATION ─────────────
	const choicePhones = choicePhonesParam
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	if (choicePhones.length > 0) {
		const matches = contactRows.filter((c: any) =>
			choicePhones.includes(String(c.phone_number)),
		);

		const digitIndex = digits ? parseInt(digits) : NaN;
		const speechIndex = speechMap[normalize(speechResult)];
		const index = digitIndex || speechIndex;

		if (index >= 1 && index <= matches.length) {
			const selected = matches[index - 1];

			// ✅ UPDATE DB (fixes "Unknown")
			await supabase
				.from("calls")
				.update({
					contact_name: selected.name,
					destination_phone: selected.phone_number,
					status: "dialing",
				})
				.eq("id", call.id);

			const recordingCallback = `${baseUrl}/api/twilio/recording`;
			const statusCallback = `${baseUrl}/api/twilio/call-status`;
			const callerId = process.env.TWILIO_PHONE_NUMBER || "";

			return xml(`
<Response>
	<Say>Calling ${escape(selected.name)}</Say>
	<Dial
		callerId="${callerId}"
		record="record-from-answer"
		recordingChannels="dual"
		recordingStatusCallback="${recordingCallback}"
		recordingStatusCallbackMethod="POST"
		action="${statusCallback}"
		method="POST"
	>
		<Number>${selected.phone_number}</Number>
	</Dial>
</Response>
`);
		}

		const menuAction = `${baseUrl}/api/twilio/voice/collect?choicePhones=${encodeURIComponent(choicePhonesParam)}`;

		const options = matches
			.map((c: any, i: number) => `Press ${i + 1} for ${escape(c.name)}`)
			.join(". ");

		return xml(`
<Response>
	<Gather input="dtmf speech"
			numDigits="1"
			timeout="7"
			action="${menuAction}"
			method="POST"
			actionOnEmptyResult="true">
		<Say>Please choose a valid option. ${options}</Say>
	</Gather>
</Response>
`);
	}

	// ───────────── EMPTY INPUT ─────────────
	if (!query) {
		if (retryCount < 2) {
			const retryAction = `${baseUrl}/api/twilio/voice/collect?retry=${retryCount + 1}`;

			return xml(`
<Response>
	<Gather input="speech"
		timeout="5"
		action="${retryAction}"
		method="POST"
		actionOnEmptyResult="true">
		<Say>I didn’t catch that. Please say the contact name.</Say>
	</Gather>
</Response>
`);
		}

		return xml(
			`<Response><Say>Sorry, I couldn’t understand. Goodbye.</Say><Hangup/></Response>`,
		);
	}

	// ───────────── SEARCH ─────────────
	const matches = contactRows.filter((c: any) => matchesName(c.name, query));

	if (matches.length === 1) {
		const c = matches[0];

		await supabase
			.from("calls")
			.update({
				contact_name: c.name,
				destination_phone: c.phone_number,
				status: "dialing",
			})
			.eq("id", call.id);

		const recordingCallback = `${baseUrl}/api/twilio/recording`;
		const statusCallback = `${baseUrl}/api/twilio/call-status`;
		const callerId = process.env.TWILIO_PHONE_NUMBER || "";

		return xml(`
<Response>
	<Say>Calling ${escape(c.name)}</Say>
	<Dial
		callerId="${callerId}"
		record="record-from-answer"
		recordingChannels="dual"
		recordingStatusCallback="${recordingCallback}"
		recordingStatusCallbackMethod="POST"
		action="${statusCallback}"
		method="POST"
	>
		<Number>${c.phone_number}</Number>
	</Dial>
</Response>
`);
	}

	if (matches.length > 1) {
		const top = matches.slice(0, 3);
		const phones = top.map((c: any) => c.phone_number).join(",");

		const menuAction = `${baseUrl}/api/twilio/voice/collect?choicePhones=${encodeURIComponent(phones)}`;

		const options = top
			.map((c: any, i: number) => `Press ${i + 1} for ${escape(c.name)}`)
			.join(". ");

		return xml(`
<Response>
	<Gather input="dtmf speech"
			numDigits="1"
			timeout="7"
			action="${menuAction}"
			method="POST"
			actionOnEmptyResult="true">
		<Say>I found multiple matches. ${options}</Say>
	</Gather>
</Response>
`);
	}

	// ───────────── SUGGESTIONS ─────────────
	const normalizedQuery = normalize(query);

	const scored = contactRows
		.map((c: any) => {
			const tokens = normalize(c.name).split(" ");
			const best = Math.max(
				...tokens.map((t) => similarity(t, normalizedQuery)),
			);
			return { contact: c, score: best };
		})
		.filter((x: any) => x.score > 0.6)
		.sort((a: any, b: any) => b.score - a.score)
		.slice(0, 3);

	if (scored.length > 0) {
		const top = scored.map((s: any) => s.contact);
		const phones = top.map((c: any) => c.phone_number).join(",");

		const menuAction = `${baseUrl}/api/twilio/voice/collect?choicePhones=${encodeURIComponent(phones)}`;

		const options = top
			.map((c: any, i: number) => `Press ${i + 1} for ${escape(c.name)}`)
			.join(". ");

		return xml(`
<Response>
	<Gather input="dtmf speech"
			numDigits="1"
			timeout="7"
			action="${menuAction}"
			method="POST"
			actionOnEmptyResult="true">
		<Say>I couldn't find ${escape(query)}. Did you mean: ${options}</Say>
	</Gather>
</Response>
`);
	}

	// fallback retry
	if (retryCount < 2) {
		const retryAction = `${baseUrl}/api/twilio/voice/collect?retry=${retryCount + 1}`;

		return xml(`
<Response>
	<Gather input="speech"
		timeout="5"
		action="${retryAction}"
		method="POST"
		actionOnEmptyResult="true">
		<Say>I couldn’t find ${escape(query)}. Try again.</Say>
	</Gather>
</Response>
`);
	}

	return xml(
		`<Response><Say>I couldn’t find that contact. Goodbye.</Say><Hangup/></Response>`,
	);
}
