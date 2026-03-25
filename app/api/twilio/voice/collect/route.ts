import { getSupabaseServiceClient } from "@/app/lib/supabase-service";

/* eslint-disable @typescript-eslint/no-explicit-any */

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

const MAX_GATHER_RETRIES = 3;

function normalizeText(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function escapeForSay(value: string) {
	return value
		.replace(/&/g, "and")
		.replace(/[<>"']/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function toT9Digits(value: string) {
	const map: Record<string, string> = {
		a: "2",
		b: "2",
		c: "2",
		d: "3",
		e: "3",
		f: "3",
		g: "4",
		h: "4",
		i: "4",
		j: "5",
		k: "5",
		l: "5",
		m: "6",
		n: "6",
		o: "6",
		p: "7",
		q: "7",
		r: "7",
		s: "7",
		t: "8",
		u: "8",
		v: "8",
		w: "9",
		x: "9",
		y: "9",
		z: "9",
	};
	return value
		.toLowerCase()
		.replace(/[^a-z]/g, "")
		.split("")
		.map((ch) => map[ch] ?? "")
		.join("");
}

function levenshteinDistance(a: string, b: string): number {
	const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
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

function similarityRatio(a: string, b: string): number {
	const maxLen = Math.max(a.length, b.length);
	if (maxLen === 0) return 1;
	return 1 - levenshteinDistance(a, b) / maxLen;
}

export async function POST(request: Request) {
	const requestUrl = new URL(request.url);
	const retryCount = Number(requestUrl.searchParams.get("retry") ?? "0") || 0;
	const candidatePhonesParam =
		requestUrl.searchParams.get("candidatePhones") ?? "";
	const choicePhonesParam = requestUrl.searchParams.get("choicePhones") ?? "";
	const form = await request.formData();
	const callSid = (form.get("CallSid") ?? "").toString();
	const speechResult = (form.get("SpeechResult") ?? "").toString();
	const digits = (form.get("Digits") ?? "").toString();
	const digitsOnlyInput = digits.replace(/\D/g, "");
	const isDtmfInput = digitsOnlyInput.length > 0 && !speechResult.trim();

	const query = (speechResult || digits).trim();

	const baseUrl = baseUrlFromRequest(request);

	// ─── DISAMBIGUATION MENU (choicePhones set) ──────────────────────────────
	// This branch is checked BEFORE the empty-query guard. When a <Gather>
	// times out, Twilio falls through to the <Redirect> (no actionOnEmptyResult)
	// and posts here again with an empty body but choicePhones still in the URL.
	const choicePhones = choicePhonesParam
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	if (choicePhones.length > 0) {
		if (callSid) {
			const supabase = getSupabaseServiceClient();
			const { data: call } = await supabase
				.from("calls")
				.select("id,user_id")
				.eq("twilio_call_sid", callSid)
				.maybeSingle();

			if (call) {
				const { data: contacts } = await supabase
					.from("contacts")
					.select("id,name,phone_number")
					.eq("user_id", call.user_id)
					.limit(200);

				const contactRows = (contacts ?? []) as any[];

				const choiceMatches = choicePhones
					.map((phone) =>
						contactRows.find(
							(c: any) =>
								String(c.phone_number) === String(phone),
						),
					)
					.filter((c: any): c is any => c != null);

				// Valid digit pressed — dial the chosen contact.
				const selected = Number(digitsOnlyInput);
				if (
					digitsOnlyInput.length > 0 &&
					Number.isInteger(selected) &&
					selected >= 1 &&
					selected <= choiceMatches.length
				) {
					const match = choiceMatches[selected - 1];

					await supabase
						.from("calls")
						.update({
							contact_name: match.name,
							destination_phone: match.phone_number,
							status: "dialing",
						})
						.eq("id", call.id);

					const recordingCallback = `${baseUrl}/api/twilio/recording`;
					const statusCallback = `${baseUrl}/api/twilio/call-status`;
					const callerId = process.env.TWILIO_PHONE_NUMBER || "";

					return xml(
						[
							"<Response>",
							`<Say>Calling ${escapeForSay(String(match.name || ""))}.</Say>`,
							`<Dial callerId="${callerId}" record="record-from-answer" recordingChannels="dual" recordingStatusCallback="${recordingCallback}" recordingStatusCallbackMethod="POST" action="${statusCallback}" method="POST">`,
							`<Number>${match.phone_number}</Number>`,
							"</Dial>",
							"</Response>",
						].join(""),
					);
				}

				// No valid digit received (timeout or wrong input).
				// Re-present the menu if retries remain, preserving choicePhones.
				if (
					choiceMatches.length > 0 &&
					retryCount < MAX_GATHER_RETRIES
				) {
					const menuAction = `${baseUrl}/api/twilio/voice/collect?retry=${retryCount + 1}&choicePhones=${encodeURIComponent(choicePhonesParam)}`;
					const prompts = choiceMatches
						.slice(0, 3)
						.map(
							(c: any, i: number) =>
								`Press ${i + 1} for ${escapeForSay(String(c.name || ""))}.`,
						)
						.join(" ");

					return xml(
						[
							"<Response>",
							`<Gather input="dtmf" numDigits="1" timeout="7" action="${menuAction}" method="POST">`,
							`<Say>Please press a number to select a contact. ${prompts}</Say>`,
							"</Gather>",
							// <Redirect> instead of actionOnEmptyResult so choicePhones is never dropped
							`<Redirect method="POST">${menuAction}</Redirect>`,
							"</Response>",
						].join(""),
					);
				}

				// Retries exhausted — dial the first match rather than erroring.
				if (choiceMatches.length > 0) {
					const match = choiceMatches[0];

					await supabase
						.from("calls")
						.update({
							contact_name: match.name,
							destination_phone: match.phone_number,
							status: "dialing",
						})
						.eq("id", call.id);

					const recordingCallback = `${baseUrl}/api/twilio/recording`;
					const statusCallback = `${baseUrl}/api/twilio/call-status`;
					const callerId = process.env.TWILIO_PHONE_NUMBER || "";

					return xml(
						[
							"<Response>",
							`<Say>No selection received. Calling ${escapeForSay(String(match.name || ""))}.</Say>`,
							`<Dial callerId="${callerId}" record="record-from-answer" recordingChannels="dual" recordingStatusCallback="${recordingCallback}" recordingStatusCallbackMethod="POST" action="${statusCallback}" method="POST">`,
							`<Number>${match.phone_number}</Number>`,
							"</Dial>",
							"</Response>",
						].join(""),
					);
				}
			}
		}

		return xml(
			`<Response><Say>Sorry, something went wrong. Goodbye.</Say><Hangup/></Response>`,
		);
	}

	// ─── EMPTY QUERY ─────────────────────────────────────────────────────────
	if (!callSid || !query) {
		if (retryCount < MAX_GATHER_RETRIES) {
			const retryAction = `${baseUrl}/api/twilio/voice/collect?retry=${retryCount + 1}`;
			return xml(
				[
					"<Response>",
					`<Gather input="speech dtmf" timeout="5" action="${retryAction}" method="POST">`,
					"<Say>Sorry, I didn't catch that. Please say the contact name again.</Say>",
					"</Gather>",
					`<Redirect method="POST">${retryAction}</Redirect>`,
					"</Response>",
				].join(""),
			);
		}
		return xml(
			`<Response><Say>Sorry, I failed to understand. Goodbye.</Say><Hangup/></Response>`,
		);
	}

	// ─── LOAD CALL + CONTACTS ─────────────────────────────────────────────────
	const supabase = getSupabaseServiceClient();
	const { data: call, error } = await supabase
		.from("calls")
		.select("id,user_id")
		.eq("twilio_call_sid", callSid)
		.maybeSingle();

	if (error || !call) {
		return xml(
			`<Response><Say>Unable to find your call. Goodbye.</Say><Hangup/></Response>`,
		);
	}

	const { data: contacts, error: contactsError } = await supabase
		.from("contacts")
		.select("id,name,phone_number")
		.eq("user_id", call.user_id)
		.limit(200);

	if (contactsError) {
		return xml(
			`<Response><Say>Sorry, I couldn't load your contacts. Goodbye.</Say><Hangup/></Response>`,
		);
	}

	const normalizedQuery = normalizeText(query);
	const contactRows = (contacts ?? []) as any[];

	const candidatePhones = candidatePhonesParam
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	const dialContact = async (match: any) => {
		await supabase
			.from("calls")
			.update({
				contact_name: match.name,
				destination_phone: match.phone_number,
				status: "dialing",
			})
			.eq("id", call.id);

		const recordingCallback = `${baseUrl}/api/twilio/recording`;
		const statusCallback = `${baseUrl}/api/twilio/call-status`;
		const callerId = process.env.TWILIO_PHONE_NUMBER || "";

		return xml(
			[
				"<Response>",
				`<Say>Calling ${escapeForSay(String(match.name || ""))}.</Say>`,
				`<Dial callerId="${callerId}" record="record-from-answer" recordingChannels="dual" recordingStatusCallback="${recordingCallback}" recordingStatusCallbackMethod="POST" action="${statusCallback}" method="POST">`,
				`<Number>${match.phone_number}</Number>`,
				"</Dial>",
				"</Response>",
			].join(""),
		);
	};

	// ─── CANDIDATE PHONES (last-4 disambiguation) ────────────────────────────
	if (candidatePhones.length > 0) {
		const candidateSet = new Set(candidatePhones.map(String));
		const shortlist = contactRows.filter((c: any) =>
			candidateSet.has(String(c.phone_number)),
		);

		const digitsOnly = query.replace(/\D/g, "");
		const last4 = digitsOnly.length >= 4 ? digitsOnly.slice(-4) : "";

		if (last4) {
			const last4Matches = shortlist.filter((c: any) =>
				String(c.phone_number).endsWith(last4),
			);

			if (last4Matches.length === 1) {
				return dialContact(last4Matches[0]);
			}

			if (last4Matches.length > 1 && retryCount < MAX_GATHER_RETRIES) {
				const retryAction = `${baseUrl}/api/twilio/voice/collect?retry=${retryCount + 1}&candidatePhones=${encodeURIComponent(candidatePhonesParam)}`;
				return xml(
					[
						"<Response>",
						`<Gather input="speech dtmf" timeout="5" action="${retryAction}" method="POST">`,
						`<Say>I found multiple contacts with those last 4 digits. Please say the last 4 digits again.</Say>`,
						"</Gather>",
						`<Redirect method="POST">${retryAction}</Redirect>`,
						"</Response>",
					].join(""),
				);
			}
			if (last4Matches.length > 0) {
				return dialContact(last4Matches[0]);
			}
		}

		const queryTokens = normalizedQuery.split(" ").filter(Boolean);
		const exactMatches = shortlist.filter(
			(c: any) => normalizeText(c.name) === normalizedQuery,
		);
		const prefixMatches = shortlist.filter((c: any) =>
			normalizeText(c.name).startsWith(normalizedQuery),
		);
		const includesMatches = shortlist.filter((c: any) =>
			normalizeText(c.name).includes(normalizedQuery),
		);
		const tokenMatches = shortlist.filter((c: any) => {
			const name = normalizeText(c.name);
			return queryTokens.every((token: string) => name.includes(token));
		});

		const mergedCandidates = [
			...exactMatches,
			...prefixMatches,
			...includesMatches,
			...tokenMatches,
		].filter(
			(item: any, index: number, arr: any[]) =>
				arr.findIndex((x: any) => String(x.id) === String(item.id)) ===
				index,
		);

		const match = mergedCandidates[0];
		if (match) {
			return dialContact(match);
		}
	}

	// ─── T9 / DTMF INPUT ─────────────────────────────────────────────────────
	if (isDtmfInput) {
		const t9Matches = contactRows.filter((c: any) =>
			toT9Digits(String(c.name ?? "")).startsWith(digitsOnlyInput),
		);

		if (t9Matches.length === 1) {
			return dialContact(t9Matches[0]);
		}

		if (t9Matches.length > 1 && retryCount < MAX_GATHER_RETRIES) {
			const top = t9Matches.slice(0, 3);
			const phones = top
				.map((c: any) => String(c.phone_number))
				.join(",");
			const menuAction = `${baseUrl}/api/twilio/voice/collect?retry=${retryCount + 1}&choicePhones=${encodeURIComponent(phones)}`;
			const prompts = top
				.map(
					(c: any, i: number) =>
						`Press ${i + 1} for ${escapeForSay(String(c.name || ""))}.`,
				)
				.join(" ");

			return xml(
				[
					"<Response>",
					`<Gather input="dtmf" numDigits="1" timeout="7" action="${menuAction}" method="POST">`,
					`<Say>I found multiple matches for ${digitsOnlyInput}. ${prompts}</Say>`,
					"</Gather>",
					`<Redirect method="POST">${menuAction}</Redirect>`,
					"</Response>",
				].join(""),
			);
		}
	}

	// ─── SPEECH SEARCH ───────────────────────────────────────────────────────
	const queryTokens = normalizedQuery.split(" ").filter(Boolean);
	const exactMatches = contactRows.filter(
		(c: any) => normalizeText(c.name) === normalizedQuery,
	);
	const prefixMatches = contactRows.filter((c: any) =>
		normalizeText(c.name).startsWith(normalizedQuery),
	);
	const includesMatches = contactRows.filter((c: any) =>
		normalizeText(c.name).includes(normalizedQuery),
	);
	const tokenMatches = contactRows.filter((c: any) => {
		const name = normalizeText(c.name);
		return queryTokens.every((token) => name.includes(token));
	});

	const mergedCandidates = [
		...exactMatches,
		...prefixMatches,
		...includesMatches,
		...tokenMatches,
	].filter(
		(item, index, arr) =>
			arr.findIndex((x: any) => String(x.id) === String(item.id)) ===
			index,
	);

	// Similarity fallback
	let suggestionMode = false;
	if (mergedCandidates.length === 0) {
		suggestionMode = true;
		const scored = contactRows
			.map((c: any) => ({
				contact: c,
				score: similarityRatio(normalizeText(c.name), normalizedQuery),
			}))
			.filter((item) => item.score >= 0.6)
			.sort((a, b) => b.score - a.score);
		mergedCandidates.push(
			...scored.slice(0, 3).map((item) => item.contact),
		);
	}

	if (mergedCandidates.length > 1 && retryCount < MAX_GATHER_RETRIES) {
		const top = mergedCandidates.slice(0, 3);
		const phones = top.map((c: any) => String(c.phone_number)).join(",");
		const menuAction = `${baseUrl}/api/twilio/voice/collect?retry=${retryCount + 1}&choicePhones=${encodeURIComponent(phones)}`;
		const prompts = top
			.map(
				(c: any, i: number) =>
					`Press ${i + 1} for ${escapeForSay(String(c.name || ""))}.`,
			)
			.join(" ");

		const intro = suggestionMode
			? `I couldn't find an exact match for ${escapeForSay(query)}. Did you mean: ${prompts}`
			: `I found multiple matches for ${escapeForSay(query)}. ${prompts}`;

		return xml(
			[
				"<Response>",
				// No actionOnEmptyResult — <Redirect> handles timeout so choicePhones is preserved
				`<Gather input="dtmf" numDigits="1" timeout="7" action="${menuAction}" method="POST">`,
				`<Say>${intro}</Say>`,
				"</Gather>",
				`<Redirect method="POST">${menuAction}</Redirect>`,
				"</Response>",
			].join(""),
		);
	}

	const match = mergedCandidates[0];

	if (!match) {
		if (retryCount < MAX_GATHER_RETRIES) {
			const retryAction = `${baseUrl}/api/twilio/voice/collect?retry=${retryCount + 1}`;
			return xml(
				[
					"<Response>",
					`<Gather input="speech dtmf" timeout="5" action="${retryAction}" method="POST">`,
					`<Say>I couldn't find a contact matching ${escapeForSay(query)}. Please try again.</Say>`,
					"</Gather>",
					`<Redirect method="POST">${retryAction}</Redirect>`,
					"</Response>",
				].join(""),
			);
		}
		return xml(
			`<Response><Say>I couldn't find a contact matching ${escapeForSay(query)}. Please add them in the bat phone app and try again.</Say><Hangup/></Response>`,
		);
	}

	return dialContact(match);
}
