import { getSupabaseServiceClient } from "@/app/lib/supabase-service";

/* eslint-disable @typescript-eslint/no-explicit-any */

function baseUrl() {
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
  const form = await request.formData();
  const callSid = (form.get("CallSid") ?? "").toString();
  const speechResult = (form.get("SpeechResult") ?? "").toString();
  const digits = (form.get("Digits") ?? "").toString();

  const query = (speechResult || digits).trim();

  if (!callSid || !query) {
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

  const normalizedQuery = query.toLowerCase();
  const contactRows = (contacts ?? []) as any[];
  const match =
    contactRows.find((c: any) => c.name.toLowerCase() === normalizedQuery) ||
    contactRows.find((c: any) =>
      c.name.toLowerCase().startsWith(normalizedQuery),
    ) ||
    contactRows.find((c: any) =>
      c.name.toLowerCase().includes(normalizedQuery),
    );

  if (!match) {
    return xml(
      `<Response><Say>I couldn't find a contact matching ${query}. Please add them in the bat phone app and try again.</Say><Hangup/></Response>`,
    );
  }

  await supabase
    .from("calls")
    .update({
      contact_name: match.name,
      destination_phone: match.phone_number,
      status: "dialing",
    })
    .eq("id", call.id);

  const recordingCallback = `${baseUrl()}/api/twilio/recording`;
  const statusCallback = `${baseUrl()}/api/twilio/call-status`;
  const callerId = process.env.TWILIO_PHONE_NUMBER || "";

  const twiml = [
    "<Response>",
    `<Say>Calling ${match.name}.</Say>`,
    `<Dial callerId="${callerId}" record="record-from-answer-dual" recordingStatusCallback="${recordingCallback}" recordingStatusCallbackMethod="POST" action="${statusCallback}" method="POST">`,
    `<Number>${match.phone_number}</Number>`,
    "</Dial>",
    "</Response>",
  ].join("");

  return xml(twiml);
}

