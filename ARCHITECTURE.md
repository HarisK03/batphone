## System Architecture Overview

### System architecture
The system is a single Next.js app (App Router) that serves:
- Mobile-first web UI (auth, settings, contacts, recents, transcript view)
- API routes for Twilio webhooks, call state updates, transcript processing, and data APIs
- Integration points to Supabase (auth + Postgres), Twilio Voice, Deepgram, and SendGrid

Core pattern:
- Synchronous voice control path stays fast (Twilio webhooks return TwiML quickly)
- Asynchronous post-call processing (transcription + email) happens after recording callbacks

### Twilio voice integration
Twilio hits the app through webhook endpoints:
- `/api/twilio/voice`: inbound entry point, validates caller and starts `<Gather>`
- `/api/twilio/voice/collect`: resolves contact from speech/DTMF and returns `<Dial>` TwiML
- `/api/twilio/call-status`: updates call status/duration after dial leg
- `/api/twilio/recording`: stores recording metadata and kicks off transcription pipeline

Calls are dialed with recording enabled (`record-from-answer`) and dual-channel recording where available, so downstream transcription can better separate sides of conversation.

### User identification via phone number
Inbound caller identity is based on Twilio `From`:
1. Normalize phone number to canonical format
2. Look up `users.phone_number`
3. If found, associate call to that user
4. If not found, TwiML informs caller the number is not registered

This gives a simple caller-as-identity model for phone channel access.

### Contact resolution workflow
When a known user calls:
1. Twilio `<Gather input="speech dtmf">` collects spoken name or keypad digits
2. Contact candidates are fetched from the user's contact list
3. Matching logic:
   - Speech/text-based normalized matching (exact/prefix/includes/token)
   - DTMF T9 support for keypad name matching
   - Duplicate-name disambiguation via last-4 or "Press 1/2/3" menu
4. On final match, system writes `contact_name`, `destination_phone`, `status=dialing`, then returns TwiML `<Dial>`

### Transcription pipeline
After recording callback:
1. Store recording SID/URL on call record
2. Download Twilio recording server-side (auth-protected)
3. Send audio to Deepgram (`/v1/listen`) with multichannel/utterance options
4. Deepgram callback (`/api/deepgram/webhook`) processes utterances
5. Build labeled transcript (caller/contact turn labeling)
6. Persist transcript status/text/error in `calls`

Failure states are persisted (`transcript_status=failed`, `transcript_error`) and surfaced in UI.

### Email delivery system
On successful transcript creation:
1. Build transcript email payload (metadata + transcript + links)
2. Send via SendGrid
3. If send fails, capture as `transcript_error` (email failure), while preserving transcript data

Email failure is non-blocking for core call completion, but visible to user.

### Data persistence model
Supabase Postgres tables:
- `users`: app identity record mapped to Supabase auth user + configured phone
- `contacts`: per-user contact name + phone
- `calls`: full call lifecycle record (twilio sid, destination, timing, status, recording, transcript fields)

Design choice: explicit call-state columns (`status`, `transcript_status`, `transcript_error`) for simple operational visibility and UI rendering.

## Key architectural tradeoffs
- Pros
  - Simple deployment: one app hosts UI + APIs
  - Fast implementation for interview/PoC velocity
  - Clear state model in one DB
  - Easy observability through call row status/error fields
- Cons
  - Tight coupling of web app and telephony webhooks
  - No separate queue/worker boundary for heavy async tasks
  - Some webhook paths rely on in-process async execution rather than durable job orchestration

## How the system could scale
- Introduce queue + workers (e.g., Redis/SQS + worker service) for transcription/email jobs
- Separate webhook ingress from processing service
- Add idempotency keys and replay-safe handlers for all webhook endpoints
- Add structured logging + tracing (per call SID/call ID correlation)
- Add caching/index strategy for large contact sets and advanced search
- Partition/archival strategy for growing `calls` data
- Add rate limiting and abuse controls on public webhook endpoints
- Multi-region deployment with region-aware webhook URLs if needed

## Limitations of the proof-of-concept
- Caller identity is based on phone number ownership assumptions (no extra phone-channel auth factor)
- Contact matching is heuristic and can still be ambiguous
- No robust background job infrastructure (retries/backoff/dead-letter queues)
- Operational dashboards/alerting are minimal
- Security hardening is basic (good for PoC, not full production posture)
- External provider dependencies (Twilio/Deepgram/SendGrid) can affect end-to-end latency and reliability

