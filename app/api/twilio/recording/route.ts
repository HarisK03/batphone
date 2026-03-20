import { getSupabaseServiceClient } from "@/app/lib/supabase-service";
import { transcribeAndEmailForCall } from "@/app/lib/transcription";
import { after } from "next/server";

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
		headers: { "Content-Type": "text/xml" },
	});
}

export async function POST(request: Request) {
	const form = await request.formData();
	const callSid = (form.get("CallSid") ?? "").toString();
	const recordingSid = (form.get("RecordingSid") ?? "").toString();
	const recordingUrl = (form.get("RecordingUrl") ?? "").toString();

	if (!callSid || !recordingSid || !recordingUrl) {
		return xml("<Response></Response>");
	}

	const supabase = getSupabaseServiceClient();
	const { error } = await supabase
		.from("calls")
		.update({
			recording_sid: recordingSid,
			recording_url: recordingUrl,
			// Move to processing as soon as recording callback arrives so calls
			// don't look stuck at pending if background processing fails early.
			transcript_status: "processing",
			transcript_error: null,
		})
		.eq("twilio_call_sid", callSid);

	if (!error) {
		const { data: call } = await supabase
			.from("calls")
			.select("id")
			.eq("twilio_call_sid", callSid)
			.maybeSingle();

		if (call?.id) {
			const appBaseUrl = baseUrlFromRequest(request);
			const callId = String(call.id);
			after(async () => {
				try {
					await transcribeAndEmailForCall(callId, appBaseUrl);
				} catch (error) {
					// Avoid leaving calls stuck in "pending" if background work crashes.
					const message = error instanceof Error ? error.message : String(error);
					await supabase
						.from("calls")
						.update({
							transcript_status: "failed",
							transcript_error: `Transcription pipeline failed: ${message}`.slice(
								0,
								900,
							),
						})
						.eq("id", callId);
				}
			});
		}
	}

	return xml("<Response></Response>");
}
