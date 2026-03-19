import { sendEmail } from "./email";
import { getSupabaseServiceClient } from "./supabase-service";

const GROQ_TRANSCRIBE_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";

export async function transcribeAndEmailForCall(callId: string) {
  const supabase = getSupabaseServiceClient();

  const { data: call } = await supabase
    .from("calls")
    .select(
      "id,user_id,contact_name,destination_phone,started_at,duration_seconds,recording_url"
    )
    .eq("id", callId)
    .maybeSingle();

  if (!call?.user_id || !call.recording_url) return;

  const { data: user } = await supabase
    .from("users")
    .select("email,name")
    .eq("id", call.user_id)
    .maybeSingle();

  if (!user?.email) return;

  if (!process.env.GROQ_API_KEY) {
    console.warn("GROQ_API_KEY not set; skipping transcription.");
    return;
  }

  await supabase
    .from("calls")
    .update({ transcript_status: "processing" })
    .eq("id", callId);

  const resp = await fetch(GROQ_TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "whisper-large-v3-turbo",
      url: call.recording_url,
      response_format: "json",
    }),
  });

  if (!resp.ok) {
    await supabase
      .from("calls")
      .update({
        transcript_status: "failed",
        transcript_error: `Groq transcription failed: ${resp.status}`,
      })
      .eq("id", callId);
    return;
  }

  const json = (await resp.json()) as { text?: string };
  const text = json.text ?? "";

  if (!text) {
    await supabase
      .from("calls")
      .update({
        transcript_status: "failed",
        transcript_error: "Groq returned empty transcript text.",
      })
      .eq("id", callId);
    return;
  }

  await supabase
    .from("calls")
    .update({ transcript_status: "completed", transcript_text: text })
    .eq("id", callId);

  const headerLines = [
    "Call Transcript",
    "",
    `Caller: ${user.name ?? user.email}`,
    `Destination: ${(call.contact_name as string | null) ?? "Unknown"}`,
    `Phone Number: ${(call.destination_phone as string | null) ?? "Unknown"}`,
    `Call Start Time: ${
      call.started_at ? new Date(call.started_at as string).toISOString() : "Unknown"
    }`,
    `Call Duration: ${
      call.duration_seconds != null
        ? `${call.duration_seconds}s`
        : "Unknown"
    }`,
    "",
  ];

  const appUrl =
    process.env.AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  const transcriptLink = `${appUrl}/calls/${callId}`;

  const emailText = [
    ...headerLines,
    text,
    "",
    `View in Bat Phone: ${transcriptLink}`,
    `Recording: ${call.recording_url}`,
  ].join("\n");

  await sendEmail({
    to: user.email,
    subject: "Your Bat Phone call transcript",
    text: emailText,
  });
}

