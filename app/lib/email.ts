import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY || "");
const fromAddress = process.env.EMAIL_FROM || "no-reply@example.com";

type EmailPayload = {
  to: string;
  subject: string;
  text: string;
};

export async function sendEmail(payload: EmailPayload) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set; skipping email send.");
    return;
  }

  await resend.emails.send({
    from: fromAddress,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
  });
}

