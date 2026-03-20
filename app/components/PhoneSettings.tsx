"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/app/lib/supabase-client";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";

export function PhoneSettings() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [name, setName] = useState("");
  const [region, setRegion] = useState<CountryCode>("US");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const countries = useMemo(() => getCountries(), []);

  const regionName = useMemo(() => {
    try {
      const d = new Intl.DisplayNames(["en"], { type: "region" });
      return (r: string) => d.of(r) ?? r;
    } catch {
      return (r: string) => r;
    }
  }, []);

  const [countryOpen, setCountryOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");

  const countryItems = useMemo(() => {
    return countries
      .map((r) => ({
        region: r as CountryCode,
        callingCode: `+${getCountryCallingCode(r)}`,
        name: regionName(r),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [countries, regionName]);

  const visibleCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return countryItems;
    return countryItems.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.callingCode.replace("+", "").startsWith(q.replace("+", "")),
    );
  }, [countryItems, countryQuery]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = getSupabaseClient();
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        const { data: userData } = await supabase.auth.getUser();
        if (!cancelled) {
          setEmail(userData.user?.email ?? "");
        }

        const res = await fetch("/api/settings/phone", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) {
          const digits = String(json.phoneNumber ?? "");

          // Try to infer region so we can show the "national" part.
          // Stored phone_number is digits-only (normalized).
          let nextRegion: CountryCode = "US";
          let nextPhone = digits;

          if (digits) {
            for (const r of countries) {
              const regionCode = r as CountryCode;
              const parsed = parsePhoneNumberFromString(digits, regionCode);
              const isValid =
                typeof parsed?.isValid === "function"
                  ? parsed.isValid()
                  : Boolean(parsed?.isValid);

              if (parsed && isValid) {
                nextRegion =
                  (parsed.country ?? regionCode) as CountryCode;
                nextPhone = parsed.nationalNumber
                  ? String(parsed.nationalNumber)
                  : digits;
                break;
              }
            }
          }

          setRegion(nextRegion);
          setPhoneNumber(nextPhone);
          setName(json.name ?? "");
        }
      } finally {
        // Keep skeleton visible briefly so the field placeholders
        // resolve together and feel less "jumpy".
        if (!cancelled) {
          await new Promise((r) => setTimeout(r, 1000));
          if (!cancelled) setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [countries]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const supabase = getSupabaseClient();
      const { data: sd } = await supabase.auth.getSession();
      const token = sd.session?.access_token;

      const parsed = parsePhoneNumberFromString(phoneNumber, region);
      const isValid =
        typeof parsed?.isValid === "function" ? parsed?.isValid() : Boolean(parsed?.isValid);

      if (!parsed || !isValid || !parsed.number) {
        setMessage("Invalid phone number for the selected country.");
        return;
      }

      // E.164 (starts with "+"). Backend normalizes it for storage + matching.
      const e164 = parsed.number;

      const res = await fetch("/api/settings/phone", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ phoneNumber: e164, name: name || undefined }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          setMessage("Phone number already in use.");
        } else {
          setMessage("Failed to save phone number.");
        }
      } else {
        setMessage("Settings saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 mt-3">
      <style>{`
        @keyframes batphoneShimmer {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(120%); }
        }
        .batphone-skeleton-shimmer {
          animation: batphoneShimmer 1.1s ease-in-out infinite;
        }
      `}</style>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="block text-[11px] font-semibold text-neutral-100">
            Phone number
          </label>
          <div className="flex items-center gap-2 relative">
            <div className="flex items-center gap-2 w-full">
              <div className="relative shrink-0">
                <button
                  type="button"
                  disabled={loading || saving}
                  onClick={() => {
                    setCountryQuery("");
                    setCountryOpen(true);
                  }}
                  className="h-[42px] rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:border-red-500/60 disabled:opacity-60"
                  aria-label="Select country"
                >
                  <span className={["font-semibold", loading ? "text-transparent" : ""].join(" ")}>
                    {`+${getCountryCallingCode(region)}`}
                  </span>
                </button>
                {loading && (
                  <div className="absolute inset-0 rounded-xl border border-neutral-800/40 bg-neutral-800/40 overflow-hidden pointer-events-none">
                    <div className="h-full w-full bg-gradient-to-r from-neutral-800/10 via-neutral-100/10 to-neutral-800/10 batphone-skeleton-shimmer" />
                  </div>
                )}
              </div>

              <div className="relative flex-1">
                <input
                  type="tel"
                  inputMode="tel"
                  className="w-full h-[42px] rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 placeholder-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:border-red-500/60 disabled:opacity-60"
                  value={loading ? "" : phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  disabled={loading || saving}
                />
                {loading && (
                  <div className="absolute inset-0 rounded-xl border border-neutral-800/40 bg-neutral-800/40 overflow-hidden pointer-events-none">
                    <div className="h-full w-full bg-gradient-to-r from-neutral-800/10 via-neutral-100/10 to-neutral-800/10 batphone-skeleton-shimmer" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-[11px] font-semibold text-neutral-100">
            Display name
          </label>
          <div className="relative">
            <input
              type="text"
              className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:border-red-500/60"
              value={loading ? "" : name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading || saving}
            />
            {loading && (
              <div className="absolute inset-0 rounded-xl border border-neutral-800/40 bg-neutral-800/40 overflow-hidden pointer-events-none">
                <div className="h-full w-full bg-gradient-to-r from-neutral-800/10 via-neutral-100/10 to-neutral-800/10 batphone-skeleton-shimmer" />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-[11px] font-semibold text-neutral-100">
            Email
          </label>
          <div className="relative">
            <input
              type="email"
              className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100/70 placeholder-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:border-red-500/60"
              value={loading ? "" : email}
              disabled
            />
            {loading && (
              <div className="absolute inset-0 rounded-xl border border-neutral-800/40 bg-neutral-800/40 overflow-hidden pointer-events-none">
                <div className="h-full w-full bg-gradient-to-r from-neutral-800/10 via-neutral-100/10 to-neutral-800/10 batphone-skeleton-shimmer" />
              </div>
            )}
          </div>
        </div>

        <div className="pt-1 relative">
          <button
            type="submit"
            disabled={loading || saving}
            className={[
              "w-full rounded-xl text-xs px-4 py-2 transition-colors shadow-sm",
              loading
                ? "bg-neutral-800/60 text-neutral-300/80 hover:bg-neutral-800/60"
                : "bg-red-500 text-neutral-100 disabled:opacity-60 hover:bg-red-600 shadow-red-500/20",
            ].join(" ")}
          >
            {loading ? <span className="opacity-0">Save</span> : saving ? "Saving..." : "Save"}
          </button>
          {loading && (
              <div className="absolute left-0 right-0 top-0 bottom-[-6px] rounded-xl overflow-hidden pointer-events-none bg-neutral-800/40 border border-neutral-800/30">
              <div className="h-full w-full bg-gradient-to-r from-neutral-800/10 via-neutral-100/10 to-neutral-800/10 batphone-skeleton-shimmer" />
            </div>
          )}
        </div>

        {message && (
          <p className="text-[11px] text-neutral-300/80">{message}</p>
        )}
      </form>

      {countryOpen && !loading && (
        <div
          className="fixed inset-0 z-40 bg-neutral-950/10 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCountryOpen(false);
          }}
        >
          <div className="absolute left-1/2 -translate-x-1/2 top-24 w-[min(420px,92vw)] rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-neutral-100">
                Select country
              </h3>
              <button
                type="button"
                onClick={() => setCountryOpen(false)}
                className="rounded-xl px-2 py-1 text-xs border border-neutral-800 text-neutral-200 hover:bg-neutral-900"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <input
                value={countryQuery}
                onChange={(e) => setCountryQuery(e.target.value)}
                placeholder="Search country"
                className="w-full rounded-2xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:border-red-500/60"
              />

              <div className="max-h-64 overflow-y-auto divide-y divide-neutral-800/60">
                {visibleCountries.map((c) => (
                  <button
                    key={c.region}
                    type="button"
                    onClick={() => {
                      setRegion(c.region);
                      setCountryOpen(false);
                    }}
                    className={[
                      "w-full text-left px-2 py-2 flex items-center justify-between",
                      c.region === region
                        ? "text-red-500 bg-red-500/10"
                        : "text-neutral-200 hover:bg-neutral-900",
                    ].join(" ")}
                  >
                    <span className="text-sm">{c.name}</span>
                    <span className="text-xs text-neutral-400">{c.callingCode}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

