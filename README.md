## Bat Phone – AI-Assisted Calling PoC

This is a mobile-first **Next.js 16 app router** project that implements an internal “bat phone”:

- Employees log in with **Google**
- Configure their own phone number and personal contacts
- Call a shared **Twilio number**
- Say who they want to call
- The system resolves the contact, dials via Twilio, records the call, transcribes it, and
- Emails a transcript and metadata to the caller, with a link back to the web UI.

It is designed to run cleanly in **GitHub Codespaces**.

## Stack

- **Frontend**: Next.js 16 (app router), React, Tailwind-style utility classes
- **Auth**: Supabase Auth with Google OAuth
- **DB**: Prisma + Supabase Postgres
- **Telephony**: Twilio Programmable Voice (webhooks + TwiML)
- **Transcription**: Deepgram (multichannel + diarized STT)
- **Email**: SendGrid

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy `.env` and fill in:

- **Google OAuth**
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
- **App URL / Twilio base**
  - `AUTH_URL` – e.g. `http://localhost:3000` or your Codespaces URL
- **Supabase (Auth)**
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Supabase (Server)**
  - `SUPABASE_SERVICE_ROLE_KEY` (keep secret)
- **Twilio**
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_PHONE_NUMBER` – the purchased bat phone number
- **SendGrid**
  - `SENDGRID_API_KEY`
  - `EMAIL_FROM` – verified sender address
- **Deepgram**
  - `DEEPGRAM_API_KEY` – from [Deepgram dashboard](https://console.deepgram.com/)

### 3. Database (Supabase tables)

This PoC uses Supabase Postgres tables directly (no Prisma).

Create the `users`, `contacts`, and `calls` tables in Supabase SQL Editor (see the `supabase/schema.sql` section below).

### `supabase/schema.sql`

```sql
-- Supabase PoC schema for Bat Phone (run in the Supabase SQL editor)

create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  phone_number text unique,
  created_at timestamptz default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  phone_number text not null,
  created_at timestamptz default now(),
  unique (user_id, name)
);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  twilio_call_sid text unique,
  contact_name text,
  destination_phone text,

  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  status text,

  recording_sid text,
  recording_url text,

  transcript_text text,
  transcript_status text not null default 'pending',
  transcript_error text,

  created_at timestamptz default now()
);

create index if not exists calls_user_id_idx on public.calls(user_id);
create index if not exists calls_created_at_idx on public.calls(created_at);
create index if not exists contacts_user_id_idx on public.contacts(user_id);
```

### 4. Run the app (local or Codespaces)

```bash
npm run dev
```

Open the URL shown in the terminal (or the forwarded port in Codespaces).

## Twilio configuration

1. Purchase / choose a Twilio phone number.
2. Set the **Voice webhook** for that number to:
   - `POST {AUTH_URL}/api/twilio/voice`
3. Make sure your app is accessible from Twilio (public URL via:
   - Codespaces forwarded URL, or
   - `ngrok` → `AUTH_URL` should match the public base.

The app will:

- Identify the caller by `From` number against the stored `User.phoneNumber`
- Prompt for a contact name using `<Gather input="speech dtmf">`
- Resolve the contact against the caller’s contacts
- `<Dial>` the destination with `record` enabled and callbacks for:
  - `/api/twilio/recording` – stores recording info and kicks off transcription + email
  - `/api/twilio/call-status` – updates duration and status

## Product flow

1. **Login**
   - Visit `/`
   - Click **Sign in with Google**
2. **Configure phone number**
   - In section “1. Your phone number”, enter the mobile number you will call from (must match Twilio caller ID format, e.g. `+15551234567`).
3. **Add contacts**
   - In “2. Contacts”, add name + phone number entries.
4. **Call the bat phone**
   - From your configured mobile number, call the Twilio number.
   - When prompted, say the contact name (e.g. “Mike Anderson”).
5. **Call + recording**
   - Twilio calls the contact from the bat number, recording automatically.
6. **Transcription + email**
   - After the recording callback fires:
    - The app downloads the **dual-channel** Twilio recording (caller vs contact on separate channels), transcribes it with **Deepgram multichannel**, then stores the labeled transcript and emails you (labels use your name/email and the contact name)
     - On completion, it stores the transcript and emails you:
       - Call metadata
       - Transcript text
       - Links to the recording and UI transcript page.
7. **Call history**
   - On the home page, section “3. Call history” shows recent calls (name, number, time, duration, transcript status).
   - Tapping a row opens `/calls/{id}` with the full transcript and recording link.

## Error handling

- **Unknown caller number**: Twilio webhook returns a polite message explaining the number isn’t registered; user should log in and set their phone number.
- **Contact not found**: Caller is informed that the contact name wasn’t found and to add the contact in the app.
- **Transcription failures**: `Call.transcriptStatus` is set to `"failed"` with an error message; transcript page shows the failure.
- **Email delivery issues**: If `SENDGRID_API_KEY` is not set or SendGrid fails, the server logs a warning but does not break the main call flow.

## Notes for the interview demo

- Walk through:
  - Google login
  - Setting your phone number
  - Adding a contact
  - Placing a real call to the Twilio number
  - Speaking the contact name
  - Watching the call appear in history
  - Showing the transcript email and the `/calls/{id}` page.

