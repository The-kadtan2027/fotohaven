import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendViewNotification(
  albumTitle: string,
  recipientEmail: string,
  shareUrl: string
) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[EMAIL] RESEND_API_KEY not set. Skipping notification.");
    return;
  }

  try {
    await resend.emails.send({
      from: "FotoHaven <notifications@fotohaven.app>", // Ensure this domain is verified in Resend
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
    console.log(`[EMAIL] Notification sent to ${recipientEmail} for album "${albumTitle}"`);
  } catch (error) {
    console.error("[EMAIL] Failed to send notification:", error);
  }
}
