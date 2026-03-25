import { getSupabaseServiceClient } from "@/app/lib/supabase-service";

/* eslint-disable @typescript-eslint/no-explicit-any */

function xml(body: string) {
	return new Response(body, {
		status: 200,
		headers: { "Content-Type": "text/xml" },
	});
}

function normalize(text: string) {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, "")
		.trim();
}

function escape(text: string) {
	return text.replace(/[<>&'"]/g, " ");
}

function baseUrlFromRequest(request: Request) {
	const host = request.headers.get("host");
	const proto = host?.includes("localhost") ? "http" : "https";
	return `${proto}://${host}`;
}

export async function POST(request: Request) {
	const form = await request.formData();

	const callSid = (form.get("CallSid") ?? "").toString();
	const speech = (form.get("SpeechResult") ?? "").toString();
	const digits = (form.get("Digits") ?? "").toString();

	console.log("[COLLECT]", { callSid, speech, digits });

	const query = (speech || digits).trim();

	const supabase = getSupabaseServiceClient();

	const { data: call } = await supabase
		.from("calls")
		.select("*")
		.eq("twilio_call_sid", callSid)
		.maybeSingle();

	if (!call) {
		return xml(`<Response><Say>Call not found.</Say><Hangup/></Response>`);
	}

	const retry = call.retry_count ?? 0;

	const { data: contacts } = await supabase
		.from("contacts")
		.select("*")
		.eq("user_id", call.user_id);

	const contactList = contacts ?? [];

	// ─────────────── DISAMBIGUATION MODE ───────────────
	if (call.choice_phones) {
		const matches = contactList.filter((c: any) =>
			call.choice_phones.includes(c.phone_number),
		);

		const index = parseInt(digits);

		if (index >= 1 && index <= matches.length) {
			const selected = matches[index - 1];

			await supabase
				.from("calls")
				.update({
					contact_name: selected.name,
					destination_phone: selected.phone_number,
					status: "dialing",
				})
				.eq("id", call.id);

			return xml(`
<Response>
	<Say>Calling ${escape(selected.name)}</Say>
	<Dial>${selected.phone_number}</Dial>
</Response>
`);
		}

		// retry
		if (retry < 2) {
			await supabase
				.from("calls")
				.update({
					retry_count: retry + 1,
				})
				.eq("id", call.id);

			return buildMenu(matches, request);
		}

		// fallback
		return xml(
			`<Response><Say>No selection made.</Say><Hangup/></Response>`,
		);
	}

	// ─────────────── SEARCH MODE ───────────────
	const normalized = normalize(query);

	const matches = contactList.filter((c: any) =>
		normalize(c.name).includes(normalized),
	);

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

		return xml(`
<Response>
	<Say>Calling ${escape(c.name)}</Say>
	<Dial>${c.phone_number}</Dial>
</Response>
`);
	}

	if (matches.length > 1) {
		const top = matches.slice(0, 3);

		await supabase
			.from("calls")
			.update({
				choice_phones: top.map((c: any) => c.phone_number),
				retry_count: 0,
			})
			.eq("id", call.id);

		return buildMenu(top, request);
	}

	// no match
	if (retry < 2) {
		await supabase
			.from("calls")
			.update({
				retry_count: retry + 1,
			})
			.eq("id", call.id);

		const action = `${baseUrlFromRequest(request)}/api/twilio/voice/collect`;

		return xml(`
<Response>
	<Gather input="speech"
		action="${action}"
		method="POST"
		actionOnEmptyResult="true">
		<Say>I couldn't find that contact. Try again.</Say>
	</Gather>
</Response>
`);
	}

	return xml(`<Response><Say>Goodbye.</Say><Hangup/></Response>`);
}

// ─────────────── MENU BUILDER ───────────────
function buildMenu(matches: any[], request: Request) {
	const action = `${baseUrlFromRequest(request)}/api/twilio/voice/collect`;

	const options = matches
		.map((c, i) => `Press ${i + 1} for ${escape(c.name)}`)
		.join(". ");

	return xml(`
<Response>
	<Gather input="dtmf"
		numDigits="1"
		timeout="7"
		action="${action}"
		method="POST"
		actionOnEmptyResult="true">
		<Say>I found multiple contacts. ${options}</Say>
	</Gather>
</Response>
`);
}
