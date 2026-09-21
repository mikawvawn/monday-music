const SITE_URL = "https://monday-music-mv.fly.dev";
const TO = "mvaughandc@gmail.com";

function subjectFor(now = new Date()): string {
  const dateStr = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
  return `Monday Music: ${dateStr}`;
}

export async function sendDigestEmail(html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("Skipping email (no RESEND_API_KEY)");
    return;
  }

  const wrapped = `<div style="text-align:center;padding:10px 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;">
  <a href="${SITE_URL}" style="color:#7a6855;">View this week online</a>
</div>
${html}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Monday Music <onboarding@resend.dev>",
      to: TO,
      subject: subjectFor(),
      html: wrapped,
    }),
  });

  if (!res.ok) throw new Error(`Resend failed: ${await res.text()}`);
  console.log(`Email sent to ${TO}`);
}
