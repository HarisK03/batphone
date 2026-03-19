import { getSupabaseServiceClient } from "@/app/lib/supabase-service";
import { transcribeAndEmailForCall } from "@/app/lib/transcription";

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
      transcript_status: "pending",
    })
    .eq("twilio_call_sid", callSid);

  if (!error) {
    const { data: call } = await supabase
      .from("calls")
      .select("id")
      .eq("twilio_call_sid", callSid)
      .maybeSingle();

    if (call?.id) {
      // Fire-and-forget transcription + email; do not block Twilio webhook.
      void transcribeAndEmailForCall(call.id as string);
    }
  }

  return xml("<Response></Response>");
}

