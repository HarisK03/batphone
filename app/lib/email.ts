import sendgridMail from "@sendgrid/mail";

const sendgridApiKey = process.env.SENDGRID_API_KEY || "";
const fromAddress = process.env.EMAIL_FROM || "no-reply@example.com";

type EmailPayload = {
	to: string;
	subject: string;
	text: string;
	html?: string;
};

export async function sendEmail(payload: EmailPayload) {
	if (!sendgridApiKey) {
    // Throw so the Deepgram webhook can mark `transcript_error` and show it to the user.
    throw new Error("SENDGRID_API_KEY not set");
	}

	sendgridMail.setApiKey(sendgridApiKey);
	await sendgridMail.send({
		from: fromAddress,
		to: payload.to,
		subject: payload.subject,
		text: payload.text,
		html:
			payload.html ??
			`<pre style="font-family: sans-serif; font-size: 14px; white-space: pre-wrap; line-height: 1.5;">${payload.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`,
	});
}
