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
  const callStatus = (form.get("CallStatus") ?? "").toString();
  const durationStr = (form.get("CallDuration") ?? "").toString();

  if (!callSid) {
    return xml("<Response></Response>");
  }

  const duration =
    typeof durationStr === "string" && durationStr
      ? parseInt(durationStr, 10) || null
      : null;

  const supabase = getSupabaseServiceClient();
  await supabase
    .from("calls")
    .update({
      status: callStatus || null,
      duration_seconds: duration,
      ended_at: new Date().toISOString(),
    })
    .eq("twilio_call_sid", callSid);

  return xml("<Response></Response>");
}

