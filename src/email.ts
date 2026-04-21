import type { Track } from "./spotify.js";
import type { CuratedRelease } from "./claude.js";

// Editorial palette — hardcoded (no CSS vars; email clients don't support them)
const BG        = "#f5ede0";
const SURFACE   = "#ede3d3";
const BORDER    = "#d8ccbe";
const TEXT      = "#1a1208";
const MUTED     = "#7a6855";
const DIM       = "#b8a890";
const ACCENT    = "#c94f2c";
const ACCENT_BG = "rgba(201,79,44,0.10)";
const HDR_BG    = "#1a1208";
const HDR_TEXT  = "#f5ede0";
const HDR_ACC   = "#e8734a";
const CHART     = ["#c94f2c", "#e8734a", "#d4a574", "#b8c4a0", "#9ab0c8"];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function secHeader(num: string, label: string, sub: string): string {
  return `<tr>
    <td style="padding:18px 0 12px;border-bottom:1px solid ${BORDER};">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td>
          <span style="font-family:'Courier New',Courier,monospace;font-size:10px;color:${ACCENT};letter-spacing:.18em;margin-right:10px;">${num}</span>
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:18px;color:${TEXT};font-weight:bold;letter-spacing:.04em;">${label}</span>
        </td>
        <td style="text-align:right;font-family:'Courier New',Courier,monospace;font-size:8px;color:${DIM};letter-spacing:.08em;">${sub}</td>
      </tr></table>
    </td>
  </tr>`;
}

function divider(): string {
  return `<tr><td style="padding:4px 28px;"><div style="height:1px;background:${BORDER};"></div></td></tr>`;
}

/** SVG donut chart from real genre breakdown. r=38, circ≈238.76 */
function donutChart(breakdown: { label: string; pct: number }[]): string {
  const CIRC = 238.76;
  const top = breakdown[0] ?? { label: "—", pct: 0 };

  let offset = 0;
  const slices = breakdown.map((g, i) => {
    const dash = (g.pct / 100) * CIRC;
    const gap = CIRC - dash;
    const el = `<circle cx="55" cy="55" r="38" fill="none" stroke="${CHART[i % CHART.length]}" stroke-width="18" stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 55 55)"/>`;
    offset += dash;
    return el;
  }).join("\n      ");

  const legend = breakdown.map((g, i) =>
    `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
      <div style="width:8px;height:8px;border-radius:2px;background:${CHART[i % CHART.length]};flex-shrink:0;"></div>
      <span style="font-family:'Courier New',Courier,monospace;font-size:9px;color:${MUTED};">${esc(g.label)}</span>
      <span style="font-family:'Courier New',Courier,monospace;font-size:9px;color:${DIM};margin-left:auto;padding-left:10px;">${g.pct}%</span>
    </div>`
  ).join("\n");

  return `<td style="width:140px;vertical-align:top;padding-right:16px;">
    <svg width="110" height="110" viewBox="0 0 110 110" xmlns="http://www.w3.org/2000/svg">
      <circle cx="55" cy="55" r="38" fill="none" stroke="${BORDER}" stroke-width="18"/>
      ${slices}
      <text x="55" y="50" text-anchor="middle" font-family="Georgia,serif" font-size="16" font-weight="bold" fill="${TEXT}">${top.pct}%</text>
      <text x="55" y="63" text-anchor="middle" font-family="Courier New,monospace" font-size="7" fill="${MUTED}">${esc(top.label.toUpperCase())}</text>
    </svg>
    <div style="margin-top:6px;">${legend}</div>
  </td>`;
}

/** Fallback wrapped stats when no genre breakdown available */
function wrappedStatsOnly(topArtistRows: string, discTags: string, estMinutes: number, newDiscoveriesCount: number): string {
  return `<td style="vertical-align:top;padding-right:14px;width:48%;">
    <div style="background:${ACCENT_BG};border:1px solid rgba(201,79,44,0.2);border-radius:4px;padding:12px 14px;margin-bottom:12px;">
      <span style="font-family:Georgia,serif;font-size:30px;color:${ACCENT};font-weight:900;line-height:1;">${estMinutes}</span>
      <span style="font-family:'Courier New',Courier,monospace;font-size:9px;color:${MUTED};letter-spacing:.08em;margin-left:8px;">MINS LISTENED</span>
    </div>
    <div style="font-family:'Courier New',Courier,monospace;font-size:8px;color:${DIM};letter-spacing:.1em;margin-bottom:6px;">TOP ARTISTS</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">${topArtistRows}</table>
  </td>
  <td style="width:52%;vertical-align:top;padding-left:14px;border-left:1px solid ${BORDER};">
    <div style="font-family:'Courier New',Courier,monospace;font-size:8px;color:${DIM};letter-spacing:.1em;margin-bottom:8px;">NEW DISCOVERIES · ${newDiscoveriesCount} ARTISTS</div>
    <div>${discTags}</div>
  </td>`;
}

const CAT_SEQUENCE: Array<[string, string]> = [
  ["NEW RELEASE", ACCENT],
  ["TOURING",     HDR_ACC],
  ["NEW RELEASE", ACCENT],
  ["FESTIVAL",    "#d4a574"],
  ["NEW RELEASE", ACCENT],
  ["MUSIC NEWS",  HDR_ACC],
];

// P1 + P3: New Releases is now section 02; shows album art
function releasesSection(releases: CuratedRelease[]): string {
  const cards = releases.slice(0, 5).map((r, i) => {
    const num = String(i + 1).padStart(2, "0");
    const isLast = i === Math.min(releases.length, 5) - 1;
    const artEl = r.imageUrl
      ? `<img src="${esc(r.imageUrl)}" width="64" height="64" style="display:block;border-radius:3px;" alt="${esc(r.title)}">`
      : `<table cellpadding="0" cellspacing="0" border="0" width="64"><tr><td style="width:64px;height:64px;background:${SURFACE};border:1px solid ${BORDER};border-radius:3px;text-align:center;vertical-align:middle;font-family:'Courier New',Courier,monospace;font-size:20px;color:${DIM};">${esc((r.source || "?")[0].toUpperCase())}</td></tr></table>`;

    return `<tr>
      <td style="padding:14px 0;border-bottom:${isLast ? "none" : `1px solid ${BORDER}`};">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="font-family:'Courier New',Courier,monospace;font-size:22px;color:${DIM};line-height:1;padding-right:10px;vertical-align:top;padding-top:3px;width:28px;">${num}</td>
          <td style="vertical-align:top;padding-right:12px;width:64px;">${artEl}</td>
          <td style="vertical-align:top;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:Georgia,'Times New Roman',serif;font-size:13px;font-weight:bold;color:${TEXT};letter-spacing:.02em;line-height:1.1;">${esc(r.title)}</td>
                <td style="text-align:right;vertical-align:top;white-space:nowrap;padding-left:8px;">
                  <span style="font-family:'Courier New',Courier,monospace;font-size:8px;color:${ACCENT};background:${SURFACE};border:1px solid ${BORDER};padding:2px 6px;border-radius:3px;">${esc(r.source)}</span>
                </td>
              </tr>
              ${r.artist ? `<tr><td colspan="2" style="font-size:10px;color:${MUTED};padding-top:2px;">${esc(r.artist)}</td></tr>` : ""}
              <tr><td colspan="2" style="font-size:11px;color:${MUTED};line-height:1.6;padding-top:5px;">${esc(r.blurb)}</td></tr>
              <tr><td colspan="2" style="padding-top:7px;">
                <a href="${esc(r.url)}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;padding:3px 10px;border-radius:3px;font-family:'Courier New',Courier,monospace;font-size:8px;font-weight:bold;letter-spacing:.1em;">READ MORE →</a>${r.spotifyUrl ? ` <a href="${esc(r.spotifyUrl)}" style="display:inline-block;background:#1DB954;color:#fff;text-decoration:none;padding:3px 10px;border-radius:3px;font-family:'Courier New',Courier,monospace;font-size:8px;font-weight:bold;letter-spacing:.1em;">▶ SPOTIFY</a>` : ""}
              </td></tr>
            </table>
          </td>
        </tr></table>
      </td>
    </tr>`;
  }).join("\n");

  return `<tr><td style="padding:0 28px 4px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      ${secHeader("02", "NEW RELEASES", `${Math.min(releases.length, 5)} ALBUMS THIS WEEK`)}
      <tr><td><table width="100%" cellpadding="0" cellspacing="0" border="0">${cards}</table></td></tr>
    </table>
  </td></tr>`;
}

// P1: Music News is now section 03
function newsSection(releases: CuratedRelease[]): string {
  const items = releases.slice(0, 6).map((r, i) => {
    const [label, color] = CAT_SEQUENCE[i % CAT_SEQUENCE.length];
    const headline = r.artist ? `${esc(r.artist)} — ${esc(r.title)}` : esc(r.title);
    return `<tr>
      <td style="padding:10px 0;border-bottom:1px solid ${BORDER};">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:top;padding-right:10px;white-space:nowrap;">
            <span style="display:inline-block;color:${color};border:1px solid ${color};font-family:'Courier New',Courier,monospace;font-size:8px;letter-spacing:.08em;padding:2px 5px;border-radius:2px;">${label}</span>
          </td>
          <td style="font-size:12px;color:${TEXT};line-height:1.55;">
            <a href="${esc(r.url)}" style="color:${TEXT};text-decoration:none;"><strong>${headline}.</strong> ${esc(r.blurb)}</a>
          </td>
          <td style="padding-left:8px;font-family:'Courier New',Courier,monospace;font-size:9px;color:${ACCENT};vertical-align:top;">→</td>
        </tr></table>
      </td>
    </tr>`;
  }).join("\n");

  return `<tr><td style="padding:0 28px 4px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      ${secHeader("03", "MUSIC NEWS", "CURATED FOR YOU")}
      <tr><td><table width="100%" cellpadding="0" cellspacing="0" border="0">${items}</table></td></tr>
    </table>
  </td></tr>`;
}

// P2: Playlist section shows longDescription blurb + 5-track preview instead of full tracklist
function playlistSection(
  tracks: Track[],
  playlistUrl: string,
  sectionNum: string,
  longDescription: string,
): string {
  const preview = tracks.slice(0, 5).map((t) =>
    `<tr>
      <td style="padding:4px 10px;font-size:11px;color:${MUTED};">
        <span style="color:${TEXT};font-weight:600;">${esc(t.artist)}</span> — ${esc(t.name)}
      </td>
    </tr>`
  ).join("\n");

  const remaining = tracks.length - 5;

  return `<tr><td style="padding:0 28px 8px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      ${secHeader(sectionNum, "YOUR PLAYLIST", `${tracks.length} TRACKS`)}
      <tr><td style="padding:14px 10px 8px;">
        <p style="font-size:13px;color:${TEXT};line-height:1.75;margin:0;">${esc(longDescription)}</p>
      </td></tr>
      <tr><td style="padding:2px 0 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">${preview}</table>
      </td></tr>
      ${remaining > 0 ? `<tr><td style="padding:4px 10px 2px;font-family:'Courier New',Courier,monospace;font-size:9px;color:${DIM};">+ ${remaining} more tracks</td></tr>` : ""}
      <tr><td style="padding:12px 10px 4px;">
        <a href="${esc(playlistUrl)}" style="display:inline-block;border:1px solid ${ACCENT};color:${ACCENT};text-decoration:none;padding:7px 16px;border-radius:3px;font-family:'Courier New',Courier,monospace;font-size:10px;font-weight:700;letter-spacing:.1em;">▶ OPEN FULL PLAYLIST IN SPOTIFY</a>
      </td></tr>
    </table>
  </td></tr>`;
}

export function buildEmailHtml(
  playlistName: string,
  description: string,
  longDescription: string,
  playlistUrl: string,
  tracks: Track[],
  newReleases: CuratedRelease[],
  topTracks: Track[],
  recentTracks: Track[],
  genreBreakdown: { label: string; pct: number }[],
): string {

  const estMinutes = Math.round(recentTracks.length * 3.2);
  const topArtists = [...new Set(topTracks.map((t) => t.artist))].slice(0, 3);
  const recentArtistSet = new Set(recentTracks.map((t) => t.artist));
  const newDiscoveries = [...new Set(tracks.map((t) => t.artist))]
    .filter((a) => !recentArtistSet.has(a))
    .slice(0, 5);

  const dateStr = new Date()
    .toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();

  const weekRange = (() => {
    const now = new Date();
    const day = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const fmt = (d: Date) =>
      d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
    return `${fmt(mon)} – ${fmt(sun)}`;
  })();

  const topArtistRows = topArtists
    .map(
      (a, i) => `<tr>
      <td style="padding:3px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="font-family:'Courier New',Courier,monospace;font-size:11px;color:${ACCENT};width:18px;vertical-align:middle;">${i + 1}</td>
          <td style="font-size:12px;color:${TEXT};font-weight:500;">${esc(a)}</td>
        </tr></table>
      </td>
    </tr>`,
    )
    .join("\n");

  const discTags =
    newDiscoveries.length > 0
      ? newDiscoveries
          .map(
            (a) =>
              `<span style="display:inline-block;font-family:'Courier New',Courier,monospace;font-size:9px;color:${ACCENT};background:${ACCENT_BG};border:1px solid rgba(201,79,44,0.2);padding:2px 8px;border-radius:3px;margin-right:4px;margin-bottom:4px;">${esc(a)}</span>`,
          )
          .join("")
      : `<span style="font-size:11px;color:${DIM};font-style:italic;">No new artists this week</span>`;

  const hasReleases = newReleases.length > 0;
  const hasGenres = genreBreakdown.length > 0;

  // P4: wrapped section layout — donut chart on left if genre data available
  const wrappedContent = hasGenres
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        ${donutChart(genreBreakdown)}
        <td style="vertical-align:top;border-left:1px solid ${BORDER};padding-left:16px;">
          <div style="background:${ACCENT_BG};border:1px solid rgba(201,79,44,0.2);border-radius:4px;padding:10px 14px;margin-bottom:12px;">
            <span style="font-family:Georgia,serif;font-size:28px;color:${ACCENT};font-weight:900;line-height:1;">${estMinutes}</span>
            <span style="font-family:'Courier New',Courier,monospace;font-size:9px;color:${MUTED};letter-spacing:.08em;margin-left:8px;">MINS LISTENED</span>
          </div>
          <div style="font-family:'Courier New',Courier,monospace;font-size:8px;color:${DIM};letter-spacing:.1em;margin-bottom:6px;">TOP ARTISTS</div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0">${topArtistRows}</table>
          <div style="margin-top:14px;font-family:'Courier New',Courier,monospace;font-size:8px;color:${DIM};letter-spacing:.1em;margin-bottom:6px;">NEW DISCOVERIES · ${newDiscoveries.length}</div>
          <div>${discTags}</div>
        </td>
      </tr></table>`
    : `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        ${wrappedStatsOnly(topArtistRows, discTags, estMinutes, newDiscoveries.length)}
      </tr></table>`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Monday Music: ${esc(playlistName)}</title>
</head>
<body style="margin:0;padding:20px;background:#e8dfd0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

<table width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="background:${BG};box-shadow:0 8px 32px rgba(0,0,0,0.28);">

  <!-- HEADER -->
  <tr>
    <td style="background:${HDR_BG};padding:22px 28px 18px;border-bottom:1px solid #2a2010;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td>
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:40px;color:${HDR_ACC};line-height:1;font-weight:900;letter-spacing:-.01em;">MONDAY</div>
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:40px;color:${HDR_TEXT};line-height:1;font-weight:900;letter-spacing:-.01em;">MUSIC</div>
        </td>
        <td style="text-align:right;vertical-align:bottom;">
          <div style="font-family:'Courier New',Courier,monospace;font-size:8px;color:#a09080;letter-spacing:.1em;margin-bottom:5px;">${dateStr}</div>
          <div style="font-size:13px;color:${HDR_TEXT};opacity:.85;">Hey <strong>Mike</strong> — curated for you.</div>
        </td>
      </tr></table>
    </td>
  </tr>

  <!-- 01: THIS WEEK WRAPPED -->
  <tr>
    <td style="padding:0 28px 4px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        ${secHeader("01", "THIS WEEK WRAPPED", weekRange)}
        <tr><td style="padding:14px 0;">${wrappedContent}</td></tr>
      </table>
    </td>
  </tr>

  ${divider()}

  <!-- 02: NEW RELEASES (P1: moved before news) -->
  ${hasReleases ? releasesSection(newReleases) : ""}
  ${hasReleases ? divider() : ""}

  <!-- 03: MUSIC NEWS (P1: moved after releases) -->
  ${hasReleases ? newsSection(newReleases) : ""}
  ${hasReleases ? divider() : ""}

  <!-- 04: YOUR PLAYLIST (P2: blurb + preview) -->
  ${playlistSection(tracks, playlistUrl, hasReleases ? "04" : "02", longDescription || description)}

  <!-- FOOTER -->
  <tr>
    <td style="background:${SURFACE};border-top:1px solid ${BORDER};padding:14px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-family:Georgia,'Times New Roman',serif;font-size:12px;color:${ACCENT};font-weight:bold;letter-spacing:.08em;">MONDAY MUSIC</td>
        <td style="text-align:right;font-family:'Courier New',Courier,monospace;font-size:8px;color:${DIM};line-height:1.8;">
          Weekly music curation for Big Mike.
        </td>
      </tr></table>
    </td>
  </tr>

</table>
</body>
</html>`;

  return html;
}

export async function sendEmail(
  playlistName: string,
  description: string,
  longDescription: string,
  playlistUrl: string,
  tracks: Track[],
  newReleases: CuratedRelease[],
  topTracks: Track[],
  recentTracks: Track[],
  genreBreakdown: { label: string; pct: number }[],
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");

  const html = buildEmailHtml(playlistName, description, longDescription, playlistUrl, tracks, newReleases, topTracks, recentTracks, genreBreakdown);

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
