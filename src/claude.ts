import Anthropic from "@anthropic-ai/sdk";
import type { Track } from "./spotify.js";
import type { NewRelease } from "./newReleases.js";

export interface PlaylistPlan {
  name: string;
  description: string;
  theme: string;
  discoveryArtists: string[]; // artist names for Spotify search
}

export interface CuratedRelease {
  artist: string;
  title: string;
  blurb: string;
  source: string;
  url: string;
  imageUrl?: string;
  spotifyUrl?: string;
  releaseType?: string;
}

function parseJson<T>(text: string): T {
  const stripped = text.replace(/```(?:json)?\s*|\s*```/g, "").trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    // Fall back to regex extraction. Try `{...}` FIRST so bucketed responses like
    // `{ "releases": [...], "news": [...] }` aren't mis-matched as a bare inner array
    // by a `[{...}]` pattern. Object-first handles both shapes correctly.
    const patterns = [/\{[\s\S]*\}/, /\[\s*\{[\s\S]*\}\s*\]/];
    for (const re of patterns) {
      const match = stripped.match(re);
      if (match) {
        try {
          return JSON.parse(match[0]) as T;
        } catch {
          // fall through to next pattern
        }
      }
    }
    throw new Error(`Unparseable response: ${stripped.slice(0, 300)}`);
  }
}

const TASTE_PROFILE = `Big Mike's taste: indie rock / noise pop / shoegaze (Just Mustard, feeble little horse, Water from Your Eyes, Horsegirl, Chanel Beads, Alex G, Wednesday, Snail Mail, Slow Pulp), Brazilian / world music (Jorge Ben Jor, Novos Baianos, Milton Nascimento, Djavan), electronic (house, techno, downtempo, experimental, ambient), R&B / soul (Frank Ocean, Thundercat, Blood Orange). He skews underground — one level under obvious names. Already knows Slowdive, Grouper, Adrianne Lenker, Steve Lacy, Tim Maia, Peel Dream Magazine, bdrmm, Mk.gee.`;

export async function generatePlaylist(
  recentTracks: Track[],
  topTracks: Track[],
  recentPlaylistNames: string[]
): Promise<PlaylistPlan> {
  const client = new Anthropic();

  const recentArtists = [...new Set(recentTracks.map((t) => t.artist))].slice(0, 20).join(", ");
  const topArtists = [...new Set(topTracks.map((t) => t.artist))].slice(0, 30).join(", ");

  const prompt = `You are building a weekly music discovery playlist for a listener called Big Mike.

${TASTE_PROFILE}

His recent listening (last few days):
${recentArtists}

His top artists (medium term):
${topArtists}

His recent playlist names (avoid repeating the same genre thread):
${recentPlaylistNames.slice(0, 5).join(", ") || "none yet"}

Your job:
1. Pick ONE genre thread that feels fresh relative to the recent playlist names.
2. Suggest 7–9 artists that are similar to Big Mike's known artists but that he likely hasn't heard much — one level under the obvious names. They should all fit the same genre thread. Do not include any artist already in his recent listening or top artists lists above.
3. Come up with an evocative playlist name (something atmospheric, not just the genre name).

Respond with ONLY valid JSON, no markdown:
{
  "name": "playlist name",
  "description": "one sentence capturing the vibe",
  "theme": "one word genre bucket: indie|brazilian|electronic|rnb",
  "discoveryArtists": ["Artist Name 1", "Artist Name 2", "Artist Name 3"]
}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  return parseJson<PlaylistPlan>(text);
}

/**
 * Write a short playlist description based on the actual ordered tracks.
 * Called after the energy-curve selection so the blurb reflects real content.
 */
export async function describePlaylist(
  tracks: Track[],
  playlistName: string,
  theme: string,
): Promise<string> {
  const client = new Anthropic();
  const trackList = tracks.slice(0, 10).map((t) => `${t.artist} — ${t.name}`).join(", ");

  const prompt = `Write a 1–2 sentence description for this Spotify playlist.

Playlist name: "${playlistName}"
Genre theme: ${theme}
First 10 tracks: ${trackList}

Style: Bandcamp Daily's matter-of-fact writeup style. State what the playlist is doing and why the tracks belong together. Be direct and specific — name the sound, reference 1–2 artists if it helps place it. No flowery language, no press-release tone.

Respond with only the description text. No quotes, no markdown.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  return text.trim();
}

export interface CuratedBuckets {
  releases: CuratedRelease[];
  news: CuratedRelease[];
}

function interleaveBySource(releases: NewRelease[], max: number): NewRelease[] {
  const bySource = new Map<string, NewRelease[]>();
  for (const release of releases) {
    const queue = bySource.get(release.source);
    if (queue) queue.push(release);
    else bySource.set(release.source, [release]);
  }

  const sourceNames = [...bySource.keys()].sort();
  const selected: NewRelease[] = [];
  while (selected.length < max) {
    let madeProgress = false;
    for (const source of sourceNames) {
      if (selected.length >= max) break;
      const queue = bySource.get(source);
      const item = queue?.shift();
      if (!item) continue;
      selected.push(item);
      madeProgress = true;
    }
    if (!madeProgress) break;
  }

  return selected;
}

function formatReleaseList(releases: NewRelease[], max = 100): string {
  return interleaveBySource(releases, max)
    .map((r, i) => `${i + 1}. [${r.source}] ${r.artist ? `${r.artist} — ` : ""}${r.title} | ${r.url}\n   ${r.description.slice(0, 150)}`)
    .join("\n");
}

function capItemsPerSource(items: CuratedRelease[], maxPerSource: number): CuratedRelease[] {
  const counts = new Map<string, number>();
  const kept: CuratedRelease[] = [];
  for (const item of items) {
    const key = item.source?.trim() || "Unknown";
    const current = counts.get(key) ?? 0;
    if (current >= maxPerSource) continue;
    counts.set(key, current + 1);
    kept.push(item);
  }
  return kept;
}

function curationPromptHeader(recentArtists: string[], topArtists: string[], releaseList: string): string {
  return `You are curating the music section of a weekly newsletter for Big Mike.

${TASTE_PROFILE}

His recent listening: ${recentArtists.slice(0, 20).join(", ")}
His top artists: ${topArtists.slice(0, 20).join(", ")}

Here are items from music publications this week:
${releaseList}`;
}

const BUCKET_RULES = `You produce TWO buckets:

"releases" — items that describe an ACTUAL, currently-streamable album / EP / single (out now, released within the past ~3 weeks). A "new single" counts ONLY if it is already playable. Announcements of upcoming albums, reissues of old records, interviews, essays, and tour news DO NOT go here.

"news" — everything else worth covering that does NOT go in "releases": album announcements for future drops, interviews, tour announcements, reissues, essays, industry news. Each news pick must still connect to an artist in Big Mike's recent or top listening.

Constraints for both buckets:
- Prioritize picks that directly connect to artists Big Mike has listened to recently or has in his top artists. If there are not enough strong direct matches, include adjacent picks that clearly fit the same taste lane (indie/left-field, alt-pop, electronic, underground rap/R&B) and explain the fit in the blurb.
- No more than 2 items from the same publication WITHIN a bucket (max 2 releases from the same [source], and independently max 2 news from the same [source]). Spread picks across sources.
- **No artist overlap between the two buckets.** If an artist appears in "releases", do NOT pick any news item about that same artist — the release is the primary story, and a news item about the same artist is redundant. Use "news" for DIFFERENT artists that he'd care about. Fill both buckets with a mix of artists.
- Order each bucket by how strongly it fits Big Mike's taste — best first.
- If an item is a roundup/list ("new albums to stream", "best songs this week"), you MAY extract one concrete release from that item and return it as a normal release pick, as long as the returned artist/title is explicit and currently streamable.

For each pick, write exactly two sentences for the blurb:
1. One sentence describing the item — for releases, include where the band is from and what genre/sound they play; for news, describe the story (what was announced / who was interviewed / what's happening).
2. "For fans of [Artist Name], [Artist Name]." — both artists MUST come from his recent listening or top artists lists above.`;

const BUCKET_RESPONSE_SHAPE = `Respond with ONLY a JSON OBJECT with EXACTLY these two top-level keys: "releases" and "news". Do NOT return a bare array. Do NOT return only one of the two keys. Both keys MUST be present, and both MUST be arrays (either may be empty if nothing qualifies, but you should almost always find at least a few news items this week).

Exact shape:
{
  "releases": [
    { "artist": "Artist A", "title": "Album A", "blurb": "One sentence on sound/origin. For fans of X, Y.", "source": "Stereogum", "url": "https://..." },
    { "artist": "Artist B", "title": "Album B", "blurb": "One sentence on sound/origin. For fans of X, Y.", "source": "Bandcamp Daily", "url": "https://..." }
  ],
  "news": [
    { "artist": "Artist C", "title": "Story C", "blurb": "One sentence on the story. For fans of X, Y.", "source": "Stereogum", "url": "https://..." },
    { "artist": "Artist D", "title": "Story D", "blurb": "One sentence on the story. For fans of X, Y.", "source": "Bandcamp Daily", "url": "https://..." }
  ]
}

No markdown. No preamble. No text outside the JSON object.`;

/**
 * Ask Claude to bucket items into "releases" (currently streamable) and "news" (everything else).
 * Over-provisions: ~15 release candidates + ~10 news candidates, in ranked order, so downstream
 * validation can walk the list and keep the first 5 that pass.
 */
export async function curateNewReleases(
  releases: NewRelease[],
  recentArtists: string[],
  topArtists: string[]
): Promise<CuratedBuckets> {
  if (releases.length === 0) return { releases: [], news: [] };

  const client = new Anthropic();
  const releaseList = formatReleaseList(releases);

  const prompt = `${curationPromptHeader(recentArtists, topArtists, releaseList)}

${BUCKET_RULES}

Return up to 15 items in "releases" and up to 10 items in "news", ranked best-first. Aim for at least 10 releases when possible.

${BUCKET_RESPONSE_SHAPE}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });

  if (message.stop_reason === "max_tokens") {
    console.warn("curateNewReleases: response hit max_tokens limit — output may be truncated");
  }

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const parsed = parseJson<unknown>(text);
  // Defensive: if the model returned a bare array instead of {releases, news},
  // treat it as the releases bucket and leave news empty.
  if (Array.isArray(parsed)) {
    console.warn("curateNewReleases: model returned bare array, no news bucket");
    return { releases: parsed as CuratedRelease[], news: [] };
  }
  const obj = parsed as Partial<CuratedBuckets>;
  const releasesBucket = Array.isArray(obj.releases) ? capItemsPerSource(obj.releases, 2) : [];
  const newsBucket = Array.isArray(obj.news) ? capItemsPerSource(obj.news, 2) : [];
  return {
    releases: releasesBucket,
    news: newsBucket,
  };
}

/**
 * Retry fallback when release validation kills too many candidates. Asks for N more release
 * candidates, explicitly excluding URLs that have already been rejected.
 */
export async function curateMoreReleases(
  releases: NewRelease[],
  recentArtists: string[],
  topArtists: string[],
  excludedUrls: string[],
  n: number
): Promise<CuratedRelease[]> {
  if (releases.length === 0) return [];

  const client = new Anthropic();
  const releaseList = formatReleaseList(releases);
  const excludedBlock = excludedUrls.length
    ? `\n\nALREADY-REJECTED URLs (do NOT pick these again):\n${excludedUrls.map((u) => `- ${u}`).join("\n")}`
    : "";

  const prompt = `${curationPromptHeader(recentArtists, topArtists, releaseList)}${excludedBlock}

${BUCKET_RULES}

Return ONLY a JSON array of up to ${n} NEW "releases"-bucket items (no news bucket this time), ranked best-first. Do not repeat any of the already-rejected URLs above.

Respond with ONLY valid JSON array, no markdown:
[
  { "artist": "Artist Name", "title": "Album/EP/Single Title", "blurb": "One sentence on sound/origin. For fans of X, Y.", "source": "Publication name", "url": "full URL" }
]`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  return parseJson<CuratedRelease[]>(text);
}
