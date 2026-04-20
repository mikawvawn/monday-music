import type { Track } from "./spotify.js";
import type { CuratedRelease } from "./claude.js";

const SOURCE_COLORS: Record<string, string> = {
  "Pitchfork": "#f30",
  "Stereogum": "#1a1a1a",
  "Bandcamp Daily": "#1da0c3",
  "Resident Advisor": "#000",
  "Paste": "#6a3d9a",
  "Fact": "#e63946",
  "Pigeons & Planes": "#2d6a4f",
};

function sourceTag(source: string): string {
  const color = SOURCE_COLORS[source] ?? "#555";
  return `<span style="display:inline-block;background:${color};color:#fff;font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;padding:2px 7px;border-radius:3px;margin-right:8px;">${source}</span>`;
}

export async function sendEmail(
  playlistName: string,
  description: string,
  playlistUrl: string,
  tracks: Track[],
  newReleases: CuratedRelease[]
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");

  const trackList = tracks
    .map(
      (t, i) =>
        `<tr>
          <td style="padding:6px 0;color:#888;font-size:13px;width:24px;">${i + 1}</td>
          <td style="padding:6px 0;font-size:14px;"><strong>${t.artist}</strong> — ${t.name}</td>
        </tr>`
    )
    .join("\n");

  const releaseCards = newReleases
    .map(
      (r) =>
        `<div style="padding:16px 0;border-bottom:1px solid #f0f0f0;">
          ${sourceTag(r.source)}
          <span style="font-size:13px;color:#888;">${r.artist ? `${r.artist} — ` : ""}${r.title}</span>
          <p style="margin:6px 0 8px;font-size:14px;color:#333;line-height:1.5;">${r.blurb}</p>
          <a href="${r.url}" style="font-size:13px;color:#1DB954;text-decoration:none;">Read more →</a>
        </div>`
    )
    .join("\n");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#fff;color:#111;">

  <!-- Header -->
  <p style="font-size:12px;color:#aaa;text-transform:uppercase;letter-spacing:1px;margin:0 0 32px;">Monday Music · ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

  <!-- Playlist section -->
  <h1 style="font-size:26px;font-weight:700;margin:0 0 6px;line-height:1.2;">${playlistName}</h1>
  <p style="color:#666;margin:0 0 20px;font-size:15px;line-height:1.5;">${description}</p>
  <a href="${playlistUrl}" style="display:inline-block;background:#1DB954;color:#fff;text-decoration:none;padding:11px 22px;border-radius:24px;font-weight:600;font-size:14px;margin-bottom:28px;">Open in Spotify →</a>

  <table style="width:100%;border-collapse:collapse;margin-bottom:40px;">
    ${trackList}
  </table>

  ${newReleases.length > 0 ? `
  <!-- Divider -->
  <hr style="border:none;border-top:2px solid #111;margin:0 0 28px;">

  <!-- New releases section -->
  <h2 style="font-size:18px;font-weight:700;margin:0 0 4px;">new this week</h2>
  <p style="font-size:13px;color:#888;margin:0 0 20px;">releases worth your time, curated for your taste</p>
  <div style="border-top:1px solid #f0f0f0;">
    ${releaseCards}
  </div>
  ` : ""}

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
      subject: `monday music: ${playlistName}`,
      html,
    }),
  });

  if (!res.ok) throw new Error(`Resend failed: ${await res.text()}`);
  console.log("Email sent");
}
