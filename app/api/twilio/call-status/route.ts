import { getSupabaseServiceClient } from "@/app/lib/supabase-service";

function xml(body: string) {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const callSid = (form.get("CallSid") ?? "").toString();
  const parentCallStatus = (form.get("CallStatus") ?? "").toString();
  const dialCallStatus = (form.get("DialCallStatus") ?? "").toString();
  const dialDurationStr = (form.get("DialCallDuration") ?? "").toString();
  const callDurationStr = (form.get("CallDuration") ?? "").toString();

  if (!callSid) {
    return xml("<Response></Response>");
  }

  // For <Dial action>, Twilio provides DialCallStatus/DialCallDuration.
  // Fall back to parent call fields when dial-specific values are missing.
  const status = dialCallStatus || parentCallStatus || null;
  const durationRaw = dialDurationStr || callDurationStr;
  const duration =
    typeof durationRaw === "string" && durationRaw
      ? parseInt(durationRaw, 10) || null
      : null;

  const supabase = getSupabaseServiceClient();
  await supabase
    .from("calls")
    .update({
      status,
      duration_seconds: duration,
      ended_at: new Date().toISOString(),
    })
    .eq("twilio_call_sid", callSid);

  return xml("<Response></Response>");
}

