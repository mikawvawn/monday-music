import type { Track } from "./spotify.js";

export async function sendEmail(
  playlistName: string,
  description: string,
  playlistUrl: string,
  tracks: Track[]
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");

  const trackList = tracks
    .map((t, i) => `<li style="margin: 6px 0;">${i + 1}. <strong>${t.artist}</strong> — ${t.name}</li>`)
    .join("\n");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; background: #fff; color: #111;">
  <h1 style="font-size: 28px; font-weight: 700; margin: 0 0 8px;">${playlistName}</h1>
  <p style="color: #555; margin: 0 0 24px; font-size: 15px;">${description}</p>
  <a href="${playlistUrl}" style="display: inline-block; background: #1DB954; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 24px; font-weight: 600; font-size: 15px; margin-bottom: 32px;">Open in Spotify →</a>
  <hr style="border: none; border-top: 1px solid #eee; margin: 0 0 24px;" />
  <p style="font-weight: 600; margin: 0 0 12px;">Tracklist</p>
  <ol style="padding-left: 20px; margin: 0; color: #333; font-size: 14px; line-height: 1.6;">
    ${trackList}
  </ol>
</body>
</html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "onboarding@resend.dev",
      to: "mvaughandc@gmail.com",
      subject: `your playlist this week: ${playlistName}`,
      html,
    }),
  });

  if (!res.ok) throw new Error(`Resend failed: ${await res.text()}`);
  console.log("Email sent successfully");
}
