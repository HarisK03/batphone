import { z } from "zod";
import { getSupabaseServiceClient } from "@/app/lib/supabase-service";
import { ensureUserFromRequest } from "@/app/lib/auth-request";
import { normalizePhoneNumber } from "@/app/lib/phone";

/* eslint-disable @typescript-eslint/no-explicit-any */

function formatPhoneForUi(phone: string | null) {
  const v = (phone ?? "").toString().trim();
  if (!v) return "";
  return v.startsWith("+") ? v : `+${v}`;
}

const contactSchema = z.object({
  name: z.string().min(1).max(80),
  phoneNumber: z.string().min(5).max(32),
});

const contactUpdateSchema = contactSchema.extend({
  id: z.string().min(1),
});

export async function GET(request: Request) {
  const user = await ensureUserFromRequest(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("id,name,phone_number")
    .eq("user_id", user.id)
    .order("name", { ascending: true });

  if (error) return new Response("Failed to load contacts", { status: 500 });

  const rows = (data ?? []) as any[];
  const contacts = rows.map((c) => ({
    id: c.id as string,
    name: c.name as string,
    phoneNumber: formatPhoneForUi(c.phone_number as string | null),
  }));

  return Response.json({ contacts });
}

export async function POST(request: Request) {
  const user = await ensureUserFromRequest(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const json = await request.json();
  const parsed = contactSchema.safeParse(json);
  if (!parsed.success) {
    return new Response("Invalid contact", { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  const normalizedPhoneNumber = normalizePhoneNumber(parsed.data.phoneNumber);
  if (!normalizedPhoneNumber) {
    return new Response("Invalid phone number", { status: 400 });
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      phone_number: normalizedPhoneNumber,
    })
    .select("id,name,phone_number")
    .single();

  if (error || !data) {
    return new Response("Failed to add contact", { status: 500 });
  }

  const d = data as any;

  return Response.json({
    contact: {
      id: d.id as string,
      name: d.name as string,
      phoneNumber: formatPhoneForUi(d.phone_number as string | null),
    },
  });
}

export async function DELETE(request: Request) {
  const user = await ensureUserFromRequest(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("contacts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return new Response("Failed to delete contact", { status: 500 });

  return Response.json({ ok: true });
}

export async function PUT(request: Request) {
  const user = await ensureUserFromRequest(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const json = await request.json();
  const parsed = contactUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return new Response("Invalid contact", { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  const normalizedPhoneNumber = normalizePhoneNumber(parsed.data.phoneNumber);
  if (!normalizedPhoneNumber) {
    return new Response("Invalid phone number", { status: 400 });
  }

  const { data, error } = await supabase
    .from("contacts")
    .update({
      name: parsed.data.name,
      phone_number: normalizedPhoneNumber,
    })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id)
    .select("id,name,phone_number")
    .single();

  if (error || !data) {
    return new Response("Failed to update contact", { status: 500 });
  }

  return Response.json({
    contact: {
      id: data.id as string,
      name: data.name as string,
      phoneNumber: formatPhoneForUi(data.phone_number as string | null),
    },
  });
}

