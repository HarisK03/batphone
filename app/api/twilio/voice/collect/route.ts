import { getSupabaseServiceClient } from "@/app/lib/supabase-service";

/* eslint-disable @typescript-eslint/no-explicit-any */

function baseUrlFromRequest(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host");

  if (host) {
    const proto = forwardedProto || (host.includes("localhost") ? "http" : "https");
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
    a: "2", b: "2", c: "2",
    d: "3", e: "3", f: "3",
    g: "4", h: "4", i: "4",
    j: "5", k: "5", l: "5",
    m: "6", n: "6", o: "6",
    p: "7", q: "7", r: "7", s: "7",
    t: "8", u: "8", v: "8",
    w: "9", x: "9", y: "9", z: "9",
  };
  return value
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .split("")
    .map((ch) => map[ch] ?? "")
    .join("");
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const retryCount = Number(requestUrl.searchParams.get("retry") ?? "0") || 0;
  const candidatePhonesParam = requestUrl.searchParams.get("candidatePhones") ?? "";
  const choicePhonesParam = requestUrl.searchParams.get("choicePhones") ?? "";
  const form = await request.formData();
  const callSid = (form.get("CallSid") ?? "").toString();
  const speechResult = (form.get("SpeechResult") ?? "").toString();
  const digits = (form.get("Digits") ?? "").toString();
  const digitsOnlyInput = digits.replace(/\D/g, "");
  const isDtmfInput = digitsOnlyInput.length > 0 && !speechResult.trim();

  const query = (speechResult || digits).trim();

  if (!callSid || !query) {
    if (retryCount < MAX_GATHER_RETRIES) {
      const baseUrl = baseUrlFromRequest(request);
      const retryAction = `${baseUrl}/api/twilio/voice/collect?retry=${retryCount + 1}`;
      return xml(
        [
          "<Response>",
          `<Gather input="speech dtmf" timeout="5" actionOnEmptyResult="true" action="${retryAction}" method="POST">`,
          "<Say>Sorry, I didn't catch that. Please say the contact name again.</Say>",
          "</Gather>",
          "<Say>Sorry, I failed three times to understand. Ending the call now. Goodbye.</Say>",
          "<Hangup/>",
          "</Response>",
        ].join(""),
      );
    }
    return xml(
      `<Response><Say>Sorry, I didn't catch that. Goodbye.</Say><Hangup/></Response>`,
    );
  }

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
  const choicePhones = choicePhonesParam
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

    const baseUrl = baseUrlFromRequest(request);
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

  // DTMF disambiguation menu: "Press 1 for ..., 2 for ..., 3 for ..."
  if (choicePhones.length > 0) {
    const choiceSet = new Set(choicePhones.map(String));
    const choiceMatches = contactRows.filter((c: any) =>
      choiceSet.has(String(c.phone_number)),
    );

    const selected = Number(digitsOnlyInput);
    if (Number.isInteger(selected) && selected >= 1 && selected <= choiceMatches.length) {
      return dialContact(choiceMatches[selected - 1]);
    }

    if (retryCount < MAX_GATHER_RETRIES && choiceMatches.length > 0) {
      const baseUrl = baseUrlFromRequest(request);
      const retryAction = `${baseUrl}/api/twilio/voice/collect?retry=${
        retryCount + 1
      }&choicePhones=${encodeURIComponent(choicePhonesParam)}`;
      const prompts = choiceMatches
        .slice(0, 3)
        .map(
          (c: any, i: number) => `Press ${i + 1} for ${escapeForSay(String(c.name || ""))}.`,
        )
        .join(" ");
      return xml(
        [
          "<Response>",
          `<Gather input="dtmf" numDigits="1" timeout="5" actionOnEmptyResult="true" action="${retryAction}" method="POST">`,
          `<Say>I found multiple matches. ${prompts}</Say>`,
          "</Gather>",
          "<Say>Sorry, I couldn't identify a single contact. Ending the call now. Goodbye.</Say>",
          "<Hangup/>",
          "</Response>",
        ].join(""),
      );
    }
  }

  // If we were given a shortlist of candidate phone numbers (from a previous
  // ambiguous match), disambiguate using the last-4 digits.
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
        const baseUrl = baseUrlFromRequest(request);
        const retryAction = `${baseUrl}/api/twilio/voice/collect?retry=${
          retryCount + 1
        }&candidatePhones=${encodeURIComponent(candidatePhonesParam)}`;

        return xml(
          [
            "<Response>",
            `<Gather input="speech dtmf" timeout="5" actionOnEmptyResult="true" action="${retryAction}" method="POST">`,
            `<Say>I found multiple contacts with those last 4 digits. Please say the last 4 digits again.</Say>`,
            "</Gather>",
            "<Say>Sorry, I couldn't identify a single contact. Ending the call now. Goodbye.</Say>",
            "<Hangup/>",
            "</Response>",
          ].join(""),
        );
      }
      // If we still can't disambiguate, fall back to the first match.
      if (last4Matches.length > 0) {
        return dialContact(last4Matches[0]);
      }
    }

    // If last4 wasn't usable, treat the query as a name and match within the shortlist.
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
        arr.findIndex((x: any) => String(x.id) === String(item.id)) === index,
    );

    // If we have candidates, just pick the first one.
    const match = mergedCandidates[0];
    if (match) {
      return dialContact(match);
    }
  }

  // Initial DTMF/T9 flow:
  // user enters keypad digits, we map contact names to T9 and match prefixes.
  if (isDtmfInput) {
    const t9Matches = contactRows.filter((c: any) =>
      toT9Digits(String(c.name ?? "")).startsWith(digitsOnlyInput),
    );

    if (t9Matches.length === 1) {
      return dialContact(t9Matches[0]);
    }

    if (t9Matches.length > 1 && retryCount < MAX_GATHER_RETRIES) {
      const top = t9Matches.slice(0, 3);
      const baseUrl = baseUrlFromRequest(request);
      const retryAction = `${baseUrl}/api/twilio/voice/collect?retry=${
        retryCount + 1
      }&choicePhones=${encodeURIComponent(
        top.map((c: any) => String(c.phone_number)).join(","),
      )}`;
      const prompts = top
        .map(
          (c: any, i: number) => `Press ${i + 1} for ${escapeForSay(String(c.name || ""))}.`,
        )
        .join(" ");

      return xml(
        [
          "<Response>",
          `<Gather input="dtmf" numDigits="1" timeout="5" actionOnEmptyResult="true" action="${retryAction}" method="POST">`,
          `<Say>I found multiple matches for ${digitsOnlyInput}. ${prompts}</Say>`,
          "</Gather>",
          "<Say>Sorry, I couldn't identify a single contact. Ending the call now. Goodbye.</Say>",
          "<Hangup/>",
          "</Response>",
        ].join(""),
      );
    }
  }

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
      arr.findIndex((x: any) => String(x.id) === String(item.id)) === index,
  );

  if (mergedCandidates.length > 1 && retryCount < MAX_GATHER_RETRIES) {
    const baseUrl = baseUrlFromRequest(request);
    const retryAction = `${baseUrl}/api/twilio/voice/collect?retry=${
      retryCount + 1
    }&candidatePhones=${encodeURIComponent(
      mergedCandidates
        .slice(0, 3)
        .map((c: any) => String(c.phone_number))
        .join(","),
    )}`;

    const topNames = mergedCandidates
      .slice(0, 3)
      .map((c: any) => escapeForSay(String(c.name || "")))
      .filter(Boolean);
    const optionsText =
      topNames.length > 0 ? topNames.join(", ") : "multiple contacts";

    return xml(
      [
        "<Response>",
        `<Gather input="speech dtmf" timeout="5" actionOnEmptyResult="true" action="${retryAction}" method="POST">`,
        `<Say>I found multiple matches for ${escapeForSay(
          query,
        )}: ${optionsText}. Please say the last 4 digits of the phone number.</Say>`,
        "</Gather>",
        "<Say>Sorry, I failed three times to identify the contact. Ending the call now. Goodbye.</Say>",
        "<Hangup/>",
        "</Response>",
      ].join(""),
    );
  }

  const match = mergedCandidates[0];

  if (!match) {
    if (retryCount < MAX_GATHER_RETRIES) {
      const baseUrl = baseUrlFromRequest(request);
      const retryAction = `${baseUrl}/api/twilio/voice/collect?retry=${retryCount + 1}`;
      return xml(
        [
          "<Response>",
          `<Gather input="speech dtmf" timeout="5" actionOnEmptyResult="true" action="${retryAction}" method="POST">`,
          `<Say>I couldn't find a contact matching ${query}. Please try again.</Say>`,
          "</Gather>",
          "<Say>Sorry, I failed three times to find that contact. Ending the call now. Goodbye.</Say>",
          "<Hangup/>",
          "</Response>",
        ].join(""),
      );
    }
    return xml(
      `<Response><Say>I couldn't find a contact matching ${query}. Please add them in the bat phone app and try again.</Say><Hangup/></Response>`,
    );
  }

  return dialContact(match);
}

