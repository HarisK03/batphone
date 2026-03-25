import { getSupabaseServiceClient } from "@/app/lib/supabase-service";
import { normalizePhoneNumber } from "@/app/lib/phone";

function baseUrlFromRequest(request: Request) {
	const forwardedProto = request.headers.get("x-forwarded-proto");
	const forwardedHost = request.headers.get("x-forwarded-host");
	const host = forwardedHost || request.headers.get("host");

	if (host) {
		const proto =
			forwardedProto || (host.includes("localhost") ? "http" : "https");
		return `${proto}://${host}`;
	}

	return process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "";
}

function xml(body: string) {
	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": "text/xml",
		},
	});
}

export async function POST(request: Request) {
	try {
		const form = await request.formData();
		const from = (form.get("From") ?? "").toString();
		const normalizedFrom = normalizePhoneNumber(from);
		const callSid = (form.get("CallSid") ?? "").toString();

		if (!normalizedFrom || !callSid) {
			return xml(`<Response><Say>Invalid call.</Say></Response>`);
		}

		const supabase = getSupabaseServiceClient();
		const { data: user, error } = await supabase
			.from("users")
			.select("id,name")
			.eq("phone_number", normalizedFrom)
			.maybeSingle();

		if (error) {
			console.error("[twilio/voice] users lookup failed", {
				callSid,
				normalizedFrom,
				error,
			});
			return xml(
				`<Response><Say>Server error. Goodbye.</Say></Response>`,
			);
		}

		if (!user) {
			return xml(
				`<Response><Say>Sorry, this number is not registered with the bat phone. Please configure your phone number in the web app.</Say><Hangup/></Response>`,
			);
		}

		const { error: upsertError } = await supabase.from("calls").upsert(
			{
				user_id: user.id,
				twilio_call_sid: callSid,
				started_at: new Date().toISOString(),
				status: "inbound",
			},
			{ onConflict: "twilio_call_sid" },
		);

		if (upsertError) {
			console.error("[twilio/voice] calls upsert failed", {
				callSid,
				userId: user.id,
				error: upsertError,
			});
			return xml(
				`<Response><Say>Server error. Goodbye.</Say></Response>`,
			);
		}

		const baseUrl = baseUrlFromRequest(request);
		// This is the ONLY entry point — collect?retry=0 with no choicePhones.
		// We do NOT use actionOnEmptyResult here. Instead we use <Redirect> as
		// the fallback so that if the <Gather> times out without any speech,
		// Twilio falls through to the <Redirect> and re-prompts via collect
		// rather than looping back to this voice route and saying "Hi" again.
		const collectUrl = `${baseUrl}/api/twilio/voice/collect?retry=0`;

		const twiml = [
			"<Response>",
			`<Gather input="speech dtmf" timeout="5" action="${collectUrl}" method="POST">`,
			`<Say>Hi${user.name ? " " + user.name : ""}. Who would you like to call?</Say>`,
			"</Gather>",
			// Fallback: if Gather times out with no input, redirect to collect
			// which will re-prompt rather than looping back here.
			`<Redirect method="POST">${collectUrl}</Redirect>`,
			"</Response>",
		].join("");

		return xml(twiml);
	} catch (error) {
		console.error("[twilio/voice] unhandled error", error);
		return xml(
			"<Response><Say>Sorry, we hit a server issue. Please try again later.</Say><Hangup/></Response>",
		);
	}
}
