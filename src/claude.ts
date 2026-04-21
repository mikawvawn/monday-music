import Anthropic from "@anthropic-ai/sdk";
import type { Track } from "./spotify.js";
import type { NewRelease } from "./newReleases.js";

interface PlaylistPlan {
  name: string;
  description: string;
  longDescription: string;
  theme: string;
  tracks: { artist: string; track: string }[];
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
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/[\[{][\s\S]*[\]}]/);
    if (!match) throw new Error(`Unparseable response: ${text.slice(0, 200)}`);
    return JSON.parse(match[0]) as T;
  }
}

const TASTE_PROFILE = `Big Mike's taste: indie rock / noise pop / shoegaze (Just Mustard, feeble little horse, Water from Your Eyes, Horsegirl, Chanel Beads, Alex G, Wednesday, Snail Mail, Slow Pulp), Brazilian / world music (Jorge Ben Jor, Novos Baianos, Milton Nascimento, Djavan), electronic (house, techno, downtempo, experimental, ambient), R&B / soul (Frank Ocean, Thundercat, Blood Orange). He skews underground — one level under obvious names. Already knows Slowdive, Grouper, Adrianne Lenker, Steve Lacy, Tim Maia, Peel Dream Magazine, bdrmm, Mk.gee.`;

export async function generatePlaylist(
  recentTracks: Track[],
  topTracks: Track[],
  recentPlaylistNames: string[]
): Promise<PlaylistPlan> {
  const client = new Anthropic();
  const recentArtists = [...new Set(recentTracks.map((t) => t.artist))].slice(0, 30);
  const topArtists = [...new Set(topTracks.map((t) => t.artist))].slice(0, 30);

  const prompt = `You are generating a weekly music discovery playlist for a listener called Big Mike.

His recent listening (last few days):
${recentArtists.join(", ")}

His top artists (medium term):
${topArtists.join(", ")}

His recent playlist names (to avoid repeating the same genre thread):
${recentPlaylistNames.slice(0, 5).join(", ") || "none yet"}

${TASTE_PROFILE}

Your job:
- Pick ONE genre thread that feels fresh relative to the recent playlist names
- Come up with an evocative playlist name (not just the genre name — something atmospheric like "fuzzy & wrecked" or "água e samba")
- Suggest 18 tracks: ~half from artists Big Mike already knows, ~half new discoveries one level under the obvious names
- Skew towards artists currently touring or releasing new music
- Order tracks for good flow: draw in → build → peak → come down
- No two tracks from the same artist back-to-back

Respond with ONLY valid JSON, no markdown:
{
  "name": "playlist name",
  "description": "one sentence capturing the vibe",
  "longDescription": "3-4 sentences: describe the playlist's overall mood and arc, mention 2-3 standout artists or moments, explain what makes this selection feel cohesive. Write like a music journalist, not a press release.",
  "theme": "one word genre bucket: indie|brazilian|electronic|rnb",
  "tracks": [
    { "artist": "Artist Name", "track": "Track Name" }
  ]
}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  return parseJson<PlaylistPlan>(text);
}

export async function curateNewReleases(
  releases: NewRelease[],
  recentArtists: string[],
  topArtists: string[]
): Promise<CuratedRelease[]> {
  if (releases.length === 0) return [];

  const client = new Anthropic();

  const releaseList = releases
    .slice(0, 60)
    .map((r, i) => `${i + 1}. [${r.source}] ${r.artist ? `${r.artist} — ` : ""}${r.title} | ${r.url}\n   ${r.description.slice(0, 150)}`)
    .join("\n");

  const prompt = `You are curating a "new releases" section of a weekly music newsletter for Big Mike.

${TASTE_PROFILE}

His recent listening: ${recentArtists.slice(0, 20).join(", ")}
His top artists: ${topArtists.slice(0, 20).join(", ")}

Here are new releases/articles from music publications this week:
${releaseList}

Pick 5–7 items that genuinely fit Big Mike's taste. Skip anything mainstream, overhyped, or clearly outside his wheelhouse. Prioritize underground, touring artists, and things that connect to his existing taste without being too obvious.

For each pick, write exactly two sentences for the blurb:
1. One sentence describing the release — include where the band is from and what genre/sound they play.
2. "For fans of [Artist Name], [Artist Name]." — name two real, specific artists that fit the sound. Do not use artists already in Big Mike's known list unless they are genuinely the closest reference.

Respond with ONLY valid JSON array, no markdown:
[
  {
    "artist": "Artist Name or empty string if not parseable",
    "title": "Album/EP/Article Title",
    "blurb": "One sentence on sound/origin. For fans of X, Y.",
    "source": "Publication name",
    "url": "full URL"
  }
]`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  return parseJson<CuratedRelease[]>(text);
}
