import type { ArtistSummary, Track } from "./spotify.js";
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

function wrappedSection(
  topArtistsShortTerm: ArtistSummary[],
  topTracksShortTerm: Track[],
): string {
  const topArtists = topArtistsShortTerm.slice(0, 10);
  const topTracks = topTracksShortTerm.slice(0, 5);

  const topArtistRows = topArtists.length > 0
    ? topArtists
        .map(
          (artist, i) => `<tr>
      <td style="padding:4px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="font-family:'Courier New',Courier,monospace;font-size:11px;color:${ACCENT};width:18px;vertical-align:top;">${i + 1}</td>
          <td>
            <div style="font-size:12px;color:${TEXT};font-weight:600;line-height:1.35;">${esc(artist.name)}</div>
            ${artist.genres.length > 0 ? `<div style="font-size:10px;color:${MUTED};line-height:1.4;">${esc(artist.genres.slice(0, 2).join(" / "))}</div>` : ""}
          </td>
        </tr></table>
      </td>
    </tr>`,
        )
        .join("\n")
    : `<tr><td style="font-size:11px;color:${DIM};font-style:italic;padding:4px 0;">Top artists unavailable</td></tr>`;

  const topTrackRows = topTracks.length > 0
    ? topTracks
        .map(
          (track, i) => `<tr>
      <td style="padding:4px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="font-family:'Courier New',Courier,monospace;font-size:11px;color:${ACCENT};width:18px;vertical-align:top;">${i + 1}</td>
          <td>
            <div style="font-size:12px;color:${TEXT};font-weight:600;line-height:1.35;">${esc(track.name)}</div>
            <div style="font-size:10px;color:${MUTED};line-height:1.4;">${esc(`${track.artist} • ${track.album}`)}</div>
          </td>
        </tr></table>
      </td>
    </tr>`,
        )
        .join("\n")
    : `<tr><td style="font-size:11px;color:${DIM};font-style:italic;padding:4px 0;">Top tracks unavailable</td></tr>`;

  return `<table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="width:280px;vertical-align:top;padding-right:16px;">
        <div style="font-family:'Courier New',Courier,monospace;font-size:8px;color:${DIM};letter-spacing:.1em;margin-bottom:6px;">TOP ARTISTS</div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">${topArtistRows}</table>
      </td>
      <td style="width:280px;vertical-align:top;border-left:1px solid ${BORDER};padding-left:16px;">
        <div style="font-family:'Courier New',Courier,monospace;font-size:8px;color:${DIM};letter-spacing:.1em;margin-bottom:6px;">TOP TRACKS</div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">${topTrackRows}</table>
      </td>
    </tr>
  </table>`;
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
  const cards = releases.map((r, i) => {
    const num = String(i + 1).padStart(2, "0");
    const isLast = i === releases.length - 1;
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
                  ${r.releaseType ? `<span style="font-family:'Courier New',Courier,monospace;font-size:8px;color:${MUTED};background:${SURFACE};border:1px solid ${BORDER};padding:2px 6px;border-radius:3px;margin-right:4px;">${esc(r.releaseType)}</span>` : ""}
                  <span style="font-family:'Courier New',Courier,monospace;font-size:8px;color:${ACCENT};background:${SURFACE};border:1px solid ${BORDER};padding:2px 6px;border-radius:3px;">${esc(r.source)}</span>
                </td>
              </tr>
              ${r.artist ? `<tr><td colspan="2" style="font-size:10px;color:${MUTED};padding-top:2px;">${esc(r.artist)}</td></tr>` : ""}
              <tr><td colspan="2" style="font-size:11px;color:${MUTED};line-height:1.6;padding-top:5px;">${esc(r.blurb)}</td></tr>
              <tr><td colspan="2" style="padding-top:7px;">
                <a href="${esc(r.url)}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;padding:3px 10px;border-radius:3px;font-family:'Courier New',Courier,monospace;font-size:8px;font-weight:bold;letter-spacing:.1em;">READ MORE →</a>${r.spotifyUrl ? ` <a href="${esc(r.spotifyUrl)}" style="display:inline-block;background:#1DB954;color:#ffffff;text-decoration:none;padding:3px 10px;border-radius:3px;font-family:'Courier New',Courier,monospace;font-size:8px;font-weight:bold;letter-spacing:.1em;">&#9654;&#xFE0E; SPOTIFY</a>` : ""}
              </td></tr>
            </table>
          </td>
        </tr></table>
      </td>
    </tr>`;
  }).join("\n");

  return `<tr><td style="padding:0 28px 4px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      ${secHeader("02", "NEW RELEASES", `${releases.length} ALBUMS THIS WEEK`)}
      <tr><td><table width="100%" cellpadding="0" cellspacing="0" border="0">${cards}</table></td></tr>
    </table>
  </td></tr>`;
}

// P1: Music News is now section 03
function newsSection(news: CuratedRelease[]): string {
  const items = news.map((r, i) => {
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
  news: CuratedRelease[],
  topArtistsShortTerm: ArtistSummary[],
  topTracksShortTerm: Track[],
): string {
  const dateStr = new Date()
    .toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();

  const hasReleases = newReleases.length > 0;
  const hasNews = news.length > 0;

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
        ${secHeader("01", "RECENT FAVORITES", "LAST 4 WEEKS")}
        <tr><td style="padding:14px 0;">${wrappedSection(topArtistsShortTerm, topTracksShortTerm)}</td></tr>
      </table>
    </td>
  </tr>

  ${divider()}

  <!-- 02: NEW RELEASES (P1: moved before news) -->
  ${hasReleases ? releasesSection(newReleases) : ""}
  ${hasReleases ? divider() : ""}

  <!-- 03: MUSIC NEWS (P1: moved after releases) -->
  ${hasNews ? newsSection(news) : ""}
  ${hasNews ? divider() : ""}

  <!-- 04: YOUR PLAYLIST (P2: blurb + preview) -->
  ${playlistSection(tracks, playlistUrl, hasReleases || hasNews ? "04" : "02", longDescription || description)}

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
  news: CuratedRelease[],
  topArtistsShortTerm: ArtistSummary[],
  topTracksShortTerm: Track[],
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");

  const html = buildEmailHtml(playlistName, description, longDescription, playlistUrl, tracks, newReleases, news, topArtistsShortTerm, topTracksShortTerm);

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
