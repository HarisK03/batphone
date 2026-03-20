import { getSupabaseServiceClient } from "@/app/lib/supabase-service";
import { normalizePhoneNumber } from "@/app/lib/phone";

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

export async function POST(request: Request) {
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
    return xml(`<Response><Say>Server error. Goodbye.</Say></Response>`);
  }

  if (!user) {
    return xml(
      `<Response><Say>Sorry, this number is not registered with the bat phone. Please configure your phone number in the web app.</Say><Hangup/></Response>`,
    );
  }

  await supabase
    .from("calls")
    .upsert(
      {
        user_id: user.id,
        twilio_call_sid: callSid,
        started_at: new Date().toISOString(),
        status: "inbound",
      },
      { onConflict: "twilio_call_sid" },
    );

  const actionUrl = `${baseUrlFromRequest(request)}/api/twilio/voice/collect?retry=0`;

  const twiml = [
    "<Response>",
    `<Gather input="speech dtmf" timeout="5" actionOnEmptyResult="true" action="${actionUrl}" method="POST">`,
    `<Say>Hi${user.name ? " " + user.name : ""}. Who would you like to call?</Say>`,
    "</Gather>",
    `<Say>Sorry, I couldn't understand. Please try again.</Say>`,
    "<Hangup/>",
    "</Response>",
  ].join("");

  return xml(twiml);
}

