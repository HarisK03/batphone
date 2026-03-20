/**
 * Normalize phone numbers for storage + lookups.
 *
 * Goals:
 * - Accept user input with/without "+" and with formatting like spaces/dashes/parentheses.
 * - Make sure Twilio "From" matches our stored phone_number as often as possible.
 *
 * Note: without a full library (e.g. libphonenumber), we can't reliably infer missing country codes.
 */
export function normalizePhoneNumber(input: string): string {
  let v = (input ?? "").trim();
  if (!v) return "";

  // Remove extensions/fragments like "x123", "ext. 123"
  v = v.split(/(?:\sx| ext\.?| extension\.? )/i)[0] ?? v;

  // If user typed international dialing prefix 00..., convert to digits-only without "00"
  // Example: 0044 7700... => 447700...
  v = v.replace(/[^\d+]/g, "");
  if (v.startsWith("00")) v = v.slice(2);
  if (v.startsWith("+")) v = v.slice(1);

  // Digits-only canonical form for comparisons.
  v = v.replace(/\D/g, "");

  return v;
}

