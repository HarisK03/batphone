import { getSupabaseServiceClient } from "@/app/lib/supabase-service";
import { normalizePhoneNumber } from "@/app/lib/phone";

function xml(body: string) {
	return new Response(body, {
		status: 200,
		headers: { "Content-Type": "text/xml" },
	});
}

function baseUrlFromRequest(request: Request) {
	const host = request.headers.get("host");
	const proto = host?.includes("localhost") ? "http" : "https";
	return `${proto}://${host}`;
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
				`<Response><Say>This number is not registered.</Say><Hangup/></Response>`,
			);
		}

		await supabase.from("calls").upsert(
			{
				user_id: user.id,
				twilio_call_sid: callSid,
				status: "inbound",
				retry_count: 0,
				choice_phones: null,
			},
			{ onConflict: "twilio_call_sid" },
		);

		const baseUrl = baseUrlFromRequest(request);
		const action = `${baseUrl}/api/twilio/voice/collect`;

		return xml(`
<Response>
	<Gather input="speech dtmf"
		timeout="5"
		action="${action}"
		method="POST"
		actionOnEmptyResult="true">
		<Say>Hi ${user.name || ""}. Who would you like to call?</Say>
	</Gather>
</Response>
`);
	} catch (e) {
		console.error(e);
		return xml(`<Response><Say>Server error.</Say></Response>`);
	}
}
