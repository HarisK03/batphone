import { NextResponse } from "next/server";

export async function GET() {
  const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER ?? "";

  // This is a non-secret value; it's safe to expose to the client.
  return NextResponse.json({
    twilioPhoneNumber: twilioPhoneNumber || null,
  });
}

