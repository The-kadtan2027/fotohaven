import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const defaultFrom = "FotoHaven <notifications@fotohaven.live>";

function resolveFromAddress() {
  return process.env.GUEST_OTP_FROM_EMAIL || defaultFrom;
}

export async function sendViewNotification(
  albumTitle: string,
  recipientEmail: string,
  shareUrl: string
) {
  if (!resend) {
    console.warn("[EMAIL] RESEND_API_KEY not set. Skipping notification.");
    return;
  }

  const from = resolveFromAddress();

  try {
    await resend.emails.send({
      from,
      to: recipientEmail,
      subject: `Gallery Viewed: ${albumTitle}`,
      html: `
        <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; borderRadius: 10px;">
          <h2 style="color: #c9963a;">Hello!</h2>
          <p>Your client has just opened their share link for <strong>${albumTitle}</strong>.</p>
          <div style="margin: 30px 0;">
            <a href="${shareUrl}" style="background: #1a1208; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 500;">
              View Gallery
            </a>
          </div>
          <p style="font-size: 14px; color: #666;">This is an automated notification from your FotoHaven instance.</p>
        </div>
      `,
    });
    console.log(`[EMAIL] From address used: ${from}`);
    console.log(`[EMAIL] Notification sent to ${recipientEmail} for album "${albumTitle}"`);
  } catch (error) {
    console.error("[EMAIL] Failed to send notification:", error);
  }
}

export async function sendGuestOtpEmail(
  recipientEmail: string,
  otpCode: string,
  albumTitle: string
) {
  if (!resend) {
    console.warn("[EMAIL] RESEND_API_KEY not set. Skipping OTP email.");
    return;
  }

  const from = resolveFromAddress();

  try {
    await resend.emails.send({
      from,
      to: recipientEmail,
      subject: `Your OTP for ${albumTitle}`,
      html: `
        <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #1a1208;">FotoHaven OTP</h2>
          <p>Use the code below to continue:</p>
          <p style="font-size: 28px; letter-spacing: 4px; font-weight: 700; margin: 20px 0; color: #c9963a;">${otpCode}</p>
          <p>This code expires in 10 minutes.</p>
        </div>
      `,
    });
    console.log(`[EMAIL] From address used: ${from}`);
  } catch (error) {
    console.error("[EMAIL] Failed to send guest OTP:", error);
    throw error;
  }
}
