"use client";

import { useEffect, useState } from "react";
import { BatPhoneLandingMobileImpl } from "./BatPhoneLandingMobile";

export function CallBatPhone() {
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

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
      } finally {
        if (!cancelled) {
          // Keep the spinner/skeleton a bit longer so it feels intentional like Settings.
          await new Promise((r) => setTimeout(r, 2000));
          if (!cancelled) setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Prevent scrolling while this "Call Bat Phone" tab is active.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const scroller = document.querySelector<HTMLElement>(
      "[data-mobile-scroll-container]",
    );
    const prevOverflowY = scroller?.style.overflowY ?? "";
    if (scroller) {
      scroller.style.overflowY = "hidden";
    } else {
      document.body.style.overflow = "hidden";
    }
    return () => {
      if (scroller) {
        scroller.style.overflowY = prevOverflowY;
      } else {
        document.body.style.overflow = "";
      }
    };
  }, []);

  return (
    <div className="space-y-3 overflow-hidden relative">
      {loading && (
        <div className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center">
          <div
            className="w-10 h-10 rounded-full border-2 border-neutral-800 border-t-red-500 animate-spin"
            aria-hidden
          />
        </div>
      )}

      <div
        className={[
          "transition-opacity duration-300",
          loading ? "opacity-0 pointer-events-none" : "opacity-100",
        ].join(" ")}
      >
        <div className="flex justify-center">
          <div className="w-full max-w-md px-3">
            <div
              className="relative w-full"
              style={{
                transform: "scale(1.1)",
                transformOrigin: "top center",
              }}
            >
              <BatPhoneLandingMobileImpl variant="compact" />
            </div>
          </div>
        </div>

        <div className="flex justify-center mt-12">
          <div className="w-full max-w-[380px] px-4">
            {!twilioPhoneNumber ? (
              <p className="text-xs text-neutral-200">
                Missing `TWILIO_PHONE_NUMBER`. Set it in your `.env`.
              </p>
            ) : (
              <a
                href={`tel:${twilioPhoneNumber}`}
                className="rounded-2xl bg-red-500 text-neutral-100 text-sm px-14 py-5 inline-flex items-center justify-center hover:bg-red-600 transition-colors shadow-sm shadow-red-500/20 w-full"
              >
                Call Bat Phone
              </a>
            )}
            <span className="sr-only">
              {loading ? "Loading call button" : "Call Bat Phone"}
            </span>
          </div>
        </div>

        <p className="px-4 mt-2 text-xs text-neutral-300/80">
          From your configured mobile number, call the number above. When it
          answers, say the contact name.
        </p>
      </div>
    </div>
  );
}

