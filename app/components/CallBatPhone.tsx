"use client";

import { useEffect, useState } from "react";

export function CallBatPhone() {
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/twilio/phone-number");
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) {
          setTwilioPhoneNumber(json.twilioPhoneNumber ?? null);
        }
      } catch {
        if (!cancelled) setTwilioPhoneNumber(null);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!twilioPhoneNumber) {
    return (
      <p className="text-xs text-black">
        Missing `TWILIO_PHONE_NUMBER`. Set it in your `.env`.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <a
          href={`tel:${twilioPhoneNumber}`}
          className="rounded-full bg-black text-white text-xs px-4 py-2 inline-flex items-center justify-center"
        >
          Call Bat Phone
        </a>
      </div>
      <p className="text-xs text-black">
        From your configured mobile number, call the number above. When it
        answers, say the contact name.
      </p>
    </div>
  );
}

