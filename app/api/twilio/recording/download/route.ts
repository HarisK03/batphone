import { NextResponse } from "next/server";

function buildTwilioRecordingDownloadUrl(recordingUrl: string) {
	// Twilio dual-channel recordings are delivered as one audio file whose
	// channels contain each side. We request channels=2.
	const base = recordingUrl.replace(/\.(mp3|wav)$/i, "");
	return `${base}.mp3?RequestedChannels=2`;
}

function toBasicAuthHeader(accountSid: string, authToken: string) {
	const raw = `${accountSid}:${authToken}`;
	const encoded = Buffer.from(raw, "utf8").toString("base64");
	return `Basic ${encoded}`;
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const recordingUrl = url.searchParams.get("recordingUrl");

	if (!recordingUrl) {
		return new NextResponse("Missing recordingUrl", { status: 400 });
	}

	let targetUrl: URL;
	try {
		targetUrl = new URL(recordingUrl);
	} catch {
		return new NextResponse("Invalid recordingUrl", { status: 400 });
	}

	// Basic SSRF guard: only allow Twilio domains.
	// (Recording URLs are expected to be Twilio-hosted media.)
	const host = targetUrl.host.toLowerCase();
	if (!host.includes("twilio")) {
		return new NextResponse("Forbidden recordingUrl", { status: 403 });
	}

	const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
	const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN ?? "";
	if (!twilioAccountSid || !twilioAuthToken) {
		return new NextResponse("Twilio credentials missing", { status: 500 });
	}

	const mediaUrl = buildTwilioRecordingDownloadUrl(recordingUrl);
	const basicAuth = toBasicAuthHeader(twilioAccountSid, twilioAuthToken);

	const audioResp = await fetch(mediaUrl, {
		headers: {
			Authorization: basicAuth,
		},
	});

	if (!audioResp.ok) {
		return new NextResponse(
			`Failed to fetch recording (status ${audioResp.status})`,
			{ status: 502 },
		);
	}

	const contentType =
		audioResp.headers.get("content-type") ?? "audio/mpeg";

	const filename = "recording.mp3";
	const headers = new Headers();
	headers.set("Content-Type", contentType);
	headers.set("Content-Disposition", `inline; filename="${filename}"`);

	const contentLength = audioResp.headers.get("content-length");
	if (contentLength) headers.set("Content-Length", contentLength);

	// Stream audio to the client (no secrets ever hit the browser).
	if (audioResp.body) {
		return new NextResponse(audioResp.body, {
			status: 200,
			headers,
		});
	}

	const buf = await audioResp.arrayBuffer();
	return new NextResponse(buf, {
		status: 200,
		headers,
	});
}

