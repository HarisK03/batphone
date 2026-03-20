"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/app/lib/supabase-client";
import { normalizePhoneNumber } from "@/app/lib/phone";
import { AnimatePresence, motion } from "framer-motion";
import { FaPen, FaPlus, FaTrash } from "react-icons/fa";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";

type Contact = {
  id: string;
  name: string;
  phoneNumber: string;
};

export function ContactsPanel() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingPhone, setEditingPhone] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteTargetName, setDeleteTargetName] = useState<string>("");
  const [deleting, setDeleting] = useState(false);

  // Phone input (country picker + E.164 validation), similar to `PhoneSettings`.
  const countries = useMemo(() => getCountries(), []);
  const [region, setRegion] = useState<CountryCode>("US");
  const [countryOpen, setCountryOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");

  const regionName = useMemo(() => {
    try {
      const d = new Intl.DisplayNames(["en"], { type: "region" });
      return (r: string) => d.of(r) ?? r;
    } catch {
      return (r: string) => r;
    }
  }, []);

  const countryItems = useMemo(() => {
    return countries
      .map((r) => ({
        region: r as CountryCode,
        callingCode: `+${getCountryCallingCode(r as CountryCode)}`,
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

        const res = await fetch("/api/contacts", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setContacts(json.contacts ?? []);
      } finally {
        if (!cancelled) {
          // Keep spinner visible a bit longer for smoother UX.
          await new Promise((r) => setTimeout(r, 1000));
          if (!cancelled) setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = contacts.filter((c) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.phoneNumber.toLowerCase().includes(q)
    );
  });

  const indexLetters = useMemo(() => {
    // iOS-style index: A-Z and a fallback bucket for everything else.
    return ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "#"];
  }, []);

  const letterFor = (contactName: string) => {
    const first = (contactName ?? "").trim().charAt(0).toUpperCase();
    return first >= "A" && first <= "Z" ? first : "#";
  };

  const groups = useMemo(() => {
    const m = new Map<string, Contact[]>();
    for (const c of filtered) {
      const l = letterFor(c.name);
      const existing = m.get(l) ?? [];
      existing.push(c);
      m.set(l, existing);
    }
    // Sort contacts within each letter group.
    for (const [l, arr] of m.entries()) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
      m.set(l, arr);
    }
    return m;
  }, [filtered]);

  const letterRefs = useRef<Record<string, HTMLDivElement | null>>({});

  function parsePhoneToE164(input: string, fallbackRegion: CountryCode) {
    const raw = (input ?? "").trim();
    if (!raw) return null;

    const isValid = (p: unknown) => {
      if (!p) return false;
      const maybe = p as { isValid?: unknown };
      if (typeof maybe.isValid === "function") {
        return (maybe.isValid as () => boolean)();
      }
      return Boolean(maybe.isValid);
    };

    const tryParse = (r: CountryCode) => {
      const parsed = parsePhoneNumberFromString(raw, r);
      if (parsed && isValid(parsed) && parsed.number) {
        return parsed;
      }
      return null;
    };

    // Match PhoneSettings behavior: parse using the selected region only.
    // If the user needs a different region they should pick it.
    const parsed = tryParse(fallbackRegion);

    if (!parsed?.number) return null;

    return {
      e164: parsed.number,
    };
  }

  async function addContact(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!name || !phone) return;

    const parsedPhone = parsePhoneToE164(phone, region);
    if (!parsedPhone) {
      setMessage("Invalid phone number.");
      return;
    }

    setSaving(true);
    try {
      const supabase = getSupabaseClient();
      const { data: sd } = await supabase.auth.getSession();
      const token = sd.session?.access_token;
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name,
          phoneNumber: parsedPhone.e164,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setContacts((prev) => [...prev, data.contact]);
      setName("");
      setPhone("");
      setCountryOpen(false);
      setMessage(null);
      setCreateOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function removeContact(id: string) {
    const prev = contacts;
    setContacts((c) => c.filter((x) => x.id !== id));

    const supabase = getSupabaseClient();
    const { data: sd } = await supabase.auth.getSession();
    const token = sd.session?.access_token;

    const res = await fetch(`/api/contacts?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    if (!res.ok) {
      setContacts(prev);
      return false;
    }

    return true;
  }

  function openDelete(contact: Contact) {
    setDeleteTargetId(contact.id);
    setDeleteTargetName(contact.name);
    setDeleteOpen(true);
    setCountryOpen(false);
    setCreateOpen(false);
    setEditOpen(false);
    setMessage(null);
  }

  async function confirmDelete() {
    if (!deleteTargetId) return;
    setDeleting(true);
    const ok = await removeContact(deleteTargetId);
    setDeleting(false);

    if (ok) {
      setDeleteOpen(false);
      setDeleteTargetId(null);
      setDeleteTargetName("");
      setMessage(null);
    } else {
      setMessage("Failed to delete contact.");
    }
  }

  async function startEdit(contact: Contact) {
    setEditingId(contact.id);
    setEditingName(contact.name);
    setEditingPhone(contact.phoneNumber);
    setMessage(null);
    setCountryOpen(false);
    setCreateOpen(false);
    setEditOpen(true);

    // The API returns UI-formatted numbers like "+1415...".
    // Our phone input expects the "national" part (the country calling code
    // is shown separately in the country button), so we parse and prefill
    // `editingPhone` with `nationalNumber`.
    try {
      const parsed = parsePhoneNumberFromString(contact.phoneNumber);
      const isValid =
        typeof parsed?.isValid === "function"
          ? parsed.isValid()
          : Boolean(parsed?.isValid);

      if (parsed && isValid) {
        if (parsed.country) {
          setRegion(parsed.country as CountryCode);
        }
        if (parsed.nationalNumber) {
          setEditingPhone(String(parsed.nationalNumber));
        }
      } else if (contact.phoneNumber.startsWith("+")) {
        // Fallback: remove leading "+" to avoid "+{cc}" being duplicated.
        setEditingPhone(contact.phoneNumber.replace(/^\+/, ""));
      }
    } catch {
      // ignore inference errors
    }
  }

  async function cancelEdit() {
    setEditingId(null);
    setEditingName("");
    setEditingPhone("");
    setEditOpen(false);
    setCountryOpen(false);
    setMessage(null);
  }

  async function saveEdit(id: string) {
    setMessage(null);
    if (!editingName || !editingPhone) return;

    const parsedPhone = parsePhoneToE164(editingPhone, region);
    if (!parsedPhone) {
      setMessage("Invalid phone number.");
      return;
    }

    setSaving(true);
    const prev = contacts;
    const normalized = normalizePhoneNumber(parsedPhone.e164);

    setContacts((c) =>
      c.map((x) =>
        x.id === id
          ? { ...x, name: editingName, phoneNumber: normalized }
          : x,
      ),
    );

    try {
      const supabase = getSupabaseClient();
      const { data: sd } = await supabase.auth.getSession();
      const token = sd.session?.access_token;

      const res = await fetch(`/api/contacts`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          id,
          name: editingName,
          phoneNumber: parsedPhone.e164,
        }),
      });

      if (!res.ok) {
        setContacts(prev);
        return;
      }

      const data = await res.json();
      if (data?.contact) {
        setContacts((c) =>
          c.map((x) => (x.id === id ? { ...x, ...data.contact } : x)),
        );
      }
      cancelEdit();
    } catch {
      setContacts(prev);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 mt-3 w-full">
      <style>{`
        /* iOS Safari auto-linkifies phone numbers as "tel:" links and underlines them. */
        a[href^="tel"] {
          text-decoration: none !important;
        }
        a[href^="tel"]:visited {
          color: inherit !important;
        }
      `}</style>
      <div className="space-y-1">
        <label className="block text-[11px] font-semibold text-neutral-100">
          Search contacts
        </label>
        <div className="flex gap-2 items-center">
          <input
            className="flex-1 rounded-2xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:border-red-500/60"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={loading || saving}
          />
          <button
            type="button"
            aria-label="Create contact"
            onClick={() => {
              setName("");
              setPhone("");
              setMessage(null);
              setCountryOpen(false);
              setEditOpen(false);
              setCreateOpen(true);
            }}
            className="shrink-0 p-2 rounded-xl bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/15 transition-colors"
          >
            <FaPlus size={16} aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex gap-2 items-start">
        <div className="flex-1">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div
                className="w-8 h-8 rounded-full border-2 border-neutral-800 border-t-red-500 animate-spin"
                aria-hidden
              />
              <span className="sr-only">Loading contacts</span>
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <p className="text-xs text-neutral-300/80">No contacts yet.</p>
          )}

          {!loading &&
            filtered.length > 0 &&
            indexLetters.map((letter) => {
              const group = groups.get(letter);
              if (!group || group.length === 0) return null;

              return (
                <div
                  key={letter}
                  ref={(el) => {
                    letterRefs.current[letter] = el;
                  }}
                  className="pt-2"
                >
                  <div className="pb-1 border-b border-neutral-800/60 text-[11px] font-semibold text-neutral-300">
                    {letter}
                  </div>
                  <ul className="divide-y divide-neutral-800/60">
                    {group.map((c) => (
                      <li
                        key={c.id}
                        className="pt-2 pb-3 flex items-center justify-between"
                      >
                        <div>
                          <p className="text-sm font-medium text-neutral-100">
                            {c.name}
                          </p>
                          <p className="text-xs text-neutral-300/70 no-underline decoration-none">
                            <span className="batphone-phone">
                              {c.phoneNumber}
                            </span>
                          </p>
                        </div>
                        <div className="flex gap-3 items-center">
                          <button
                            type="button"
                            className="p-1.5 rounded-md text-xs text-neutral-200 hover:text-neutral-100 transition-colors"
                            onClick={() => startEdit(c)}
                          >
                            <FaPen size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="p-1.5 rounded-md text-xs text-red-500 hover:text-red-600 transition-colors"
                            onClick={() => openDelete(c)}
                            aria-label={`Remove ${c.name}`}
                          >
                            <FaTrash size={14} aria-hidden />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
        </div>

        {!loading && filtered.length > 0 && (
          <div className="w-6 shrink-0 flex flex-col items-center pt-2">
            {indexLetters.map((letter) => {
              const enabled = (groups.get(letter) ?? []).length > 0;
              return (
                <button
                  key={letter}
                  type="button"
                  disabled={!enabled}
                  onClick={() => {
                    const el = letterRefs.current[letter];
                    if (el) el.scrollIntoView({ behavior: "smooth" });
                  }}
                  className={[
                    "text-[11px] leading-4 px-0.5",
                    enabled ? "text-red-500" : "text-neutral-500/40",
                    "hover:text-red-400 transition-colors disabled:cursor-default",
                  ].join(" ")}
                  aria-label={`Jump to ${letter}`}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {createOpen && (
          <motion.div
            className="fixed inset-0 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => {
                if (!saving) {
                  setCreateOpen(false);
                  setCountryOpen(false);
                }
              }}
            />
            <motion.div
              className="absolute left-1/2 -translate-x-1/2 top-24 w-[min(420px,92vw)]"
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              transition={{ duration: 0.18 }}
            >
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 shadow-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-neutral-100">
                    New contact
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      if (!saving) {
                        setCreateOpen(false);
                        setCountryOpen(false);
                      }
                    }}
                    disabled={saving}
                    className="rounded-xl px-2 py-1 text-xs border border-neutral-800 text-neutral-200 hover:bg-neutral-900 disabled:opacity-50 transition-colors"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={addContact} className="flex flex-col gap-2">
                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-neutral-100">
                      Name
                    </label>
                    <input
                      className="w-full rounded-2xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:border-red-500/60"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={saving}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-neutral-100">
                      Phone number
                    </label>
                    <div className="flex items-center gap-2 relative">
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => {
                            setCountryQuery("");
                            setCountryOpen(true);
                          }}
                          className="h-[42px] rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:border-red-500/60 disabled:opacity-60"
                          aria-label="Select country"
                        >
                          <span className="font-semibold">
                            +{getCountryCallingCode(region)}
                          </span>
                        </button>
                      </div>
                      <div className="relative flex-1">
                        <input
                          type="tel"
                          inputMode="tel"
                          className="w-full h-[42px] rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 placeholder-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:border-red-500/60 disabled:opacity-60"
                          value={phone}
                          onChange={(e) => {
                            setPhone(e.target.value);
                          }}
                          disabled={saving}
                        />
                      </div>
                    </div>
                  </div>

                  {message && (
                    <p className="text-[11px] text-red-400/90">{message}</p>
                  )}

                  <button
                    type="submit"
                    disabled={saving || !name || !phone}
                    className="mt-1 rounded-2xl bg-red-500 text-neutral-100 text-xs px-4 py-2 disabled:opacity-60 hover:bg-red-600 transition-colors shadow-sm shadow-red-500/20"
                  >
                    {saving ? "Adding..." : "Add contact"}
                  </button>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editOpen && (
          <motion.div
            className="fixed inset-0 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => {
                if (!saving) cancelEdit();
              }}
            />
            <motion.div
              className="absolute left-1/2 -translate-x-1/2 top-24 w-[min(420px,92vw)]"
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              transition={{ duration: 0.18 }}
            >
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 shadow-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-neutral-100">
                    Edit contact
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      if (!saving) cancelEdit();
                    }}
                    disabled={saving}
                    className="rounded-xl px-2 py-1 text-xs border border-neutral-800 text-neutral-200 hover:bg-neutral-900 disabled:opacity-50 transition-colors"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (editingId) void saveEdit(editingId);
                  }}
                  className="flex flex-col gap-2"
                >
                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-neutral-100">
                      Name
                    </label>
                    <input
                      className="w-full rounded-2xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:border-red-500/60"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      disabled={saving}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-neutral-100">
                      Phone number
                    </label>
                    <div className="flex items-center gap-2 relative">
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => {
                            setCountryQuery("");
                            setCountryOpen(true);
                          }}
                          className="h-[42px] rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:border-red-500/60 disabled:opacity-60"
                          aria-label="Select country"
                        >
                          <span className="font-semibold">
                            +{getCountryCallingCode(region)}
                          </span>
                        </button>
                      </div>
                      <div className="relative flex-1">
                        <input
                          type="tel"
                          inputMode="tel"
                          className="w-full h-[42px] rounded-xl border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 placeholder-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:border-red-500/60 disabled:opacity-60"
                          value={editingPhone}
                          onChange={(e) => setEditingPhone(e.target.value)}
                          disabled={saving}
                        />
                      </div>
                    </div>
                  </div>

                  {message && (
                    <p className="text-[11px] text-red-400/90">{message}</p>
                  )}

                  <button
                    type="submit"
                    disabled={saving || !editingName || !editingPhone}
                    className="mt-1 rounded-2xl bg-red-500 text-neutral-100 text-xs px-4 py-2 disabled:opacity-60 hover:bg-red-600 transition-colors shadow-sm shadow-red-500/20"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteOpen && (
          <motion.div
            className="fixed inset-0 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => {
                if (!deleting) {
                  setDeleteOpen(false);
                  setDeleteTargetId(null);
                  setDeleteTargetName("");
                }
              }}
            />

            <motion.div
              className="absolute left-1/2 -translate-x-1/2 top-24 w-[min(420px,92vw)]"
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              transition={{ duration: 0.18 }}
            >
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 shadow-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-neutral-100">
                    Delete contact
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      if (!deleting) {
                        setDeleteOpen(false);
                        setDeleteTargetId(null);
                        setDeleteTargetName("");
                      }
                    }}
                    disabled={deleting}
                    className="rounded-xl px-2 py-1 text-xs border border-neutral-800 text-neutral-200 hover:bg-neutral-900 disabled:opacity-50 transition-colors"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                <p className="text-xs text-neutral-300/90 mb-4">
                  Are you sure you want to delete{" "}
                  <span className="text-neutral-100 font-semibold">
                    {deleteTargetName}
                  </span>
                  ?
                </p>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!deleting) {
                        setDeleteOpen(false);
                        setDeleteTargetId(null);
                        setDeleteTargetName("");
                      }
                    }}
                    disabled={deleting}
                    className="flex-1 rounded-2xl px-4 py-2 text-xs border border-neutral-800 text-neutral-200 hover:bg-neutral-900 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmDelete()}
                    disabled={deleting}
                    className="flex-1 rounded-2xl bg-red-500 text-neutral-100 text-xs px-4 py-2 disabled:opacity-60 hover:bg-red-600 transition-colors shadow-sm shadow-red-500/20 inline-flex items-center justify-center gap-2"
                  >
                    {deleting ? (
                      <span
                        className="w-4 h-4 rounded-full border-2 border-neutral-100 border-t-neutral-950 animate-spin inline-block"
                        aria-hidden
                      />
                    ) : null}
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {countryOpen && (createOpen || editOpen) && (
        <div
          className="fixed inset-0 z-60 bg-neutral-950/10 backdrop-blur-sm"
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
                className="rounded-xl px-2 py-1 text-xs border border-neutral-800 text-neutral-200 hover:bg-neutral-900 disabled:opacity-50 transition-colors"
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
                    aria-label={`Select ${c.name}`}
                  >
                    <span className="text-sm">{c.name}</span>
                    <span className="text-xs text-neutral-400">
                      {c.callingCode}
                    </span>
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

