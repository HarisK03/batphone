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

// 🔥 Better matching (supports multi-word names)
function matchesName(contactName: string, query: string) {
	const nameTokens = normalize(contactName).split(" ");
	const queryTokens = normalize(query).split(" ");

	return queryTokens.every((q) => nameTokens.some((n) => n.startsWith(q)));
}

// speech → number
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

	// get user via callSid → fallback safe
	const { data: call } = await supabase
		.from("calls")
		.select("user_id")
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

	// ─────────────── DISAMBIGUATION ───────────────
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

			return xml(`
<Response>
	<Say>Calling ${escape(selected.name)}</Say>
	<Dial>${selected.phone_number}</Dial>
</Response>
`);
		}

		// retry menu
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

	// ─────────────── EMPTY INPUT ───────────────
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

	// ─────────────── SEARCH ───────────────
	const matches = contactRows.filter((c: any) => matchesName(c.name, query));

	// single match
	if (matches.length === 1) {
		const c = matches[0];

		return xml(`
<Response>
	<Say>Calling ${escape(c.name)}</Say>
	<Dial>${c.phone_number}</Dial>
</Response>
`);
	}

	// multiple matches → menu
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

	// no match
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
