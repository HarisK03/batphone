import { getSupabaseServiceClient } from "@/app/lib/supabase-service";
import { normalizePhoneNumber } from "@/app/lib/phone";

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

export async function POST(request: Request) {
	try {
		const form = await request.formData();
		const from = normalizePhoneNumber((form.get("From") ?? "").toString());
		const callSid = (form.get("CallSid") ?? "").toString();

		if (!from || !callSid) {
			return xml(`<Response><Say>Invalid call.</Say></Response>`);
		}

		const supabase = getSupabaseServiceClient();

		const { data: user } = await supabase
			.from("users")
			.select("id,name")
			.eq("phone_number", from)
			.maybeSingle();

		if (!user) {
			return xml(
				`<Response><Say>This number is not registered. Please set your phone number in the app.</Say><Hangup/></Response>`,
			);
		}

		// store call (non-critical, no need to depend on it later)
		await supabase.from("calls").upsert(
			{
				user_id: user.id,
				twilio_call_sid: callSid,
				started_at: new Date().toISOString(),
				status: "inbound",
			},
			{ onConflict: "twilio_call_sid" },
		);

		const baseUrl = baseUrlFromRequest(request);
		const action = `${baseUrl}/api/twilio/voice/collect?retry=0`;

		return xml(`
<Response>
	<Gather input="speech dtmf"
		timeout="5"
		action="${action}"
		method="POST"
		actionOnEmptyResult="true">
		<Say>Hi ${user.name ?? ""}. Who would you like to call?</Say>
	</Gather>
</Response>
`);
	} catch (err) {
		console.error(err);
		return xml(
			`<Response><Say>Something went wrong. Goodbye.</Say><Hangup/></Response>`,
		);
	}
}
