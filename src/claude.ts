import Anthropic from "@anthropic-ai/sdk";
import type { Track } from "./spotify.js";

interface PlaylistPlan {
  name: string;
  description: string;
  theme: string;
  tracks: { artist: string; track: string }[];
}

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

Big Mike's main genre buckets — rotate through these, picking whichever feels freshest given recent playlists:
1. Indie rock / noise pop / shoegaze / fuzzy guitar (e.g. Just Mustard, feeble little horse, Water from Your Eyes, Horsegirl, Alex G, Wednesday, Snail Mail, Slow Pulp, Chanel Beads)
2. Brazilian / Latin / world music (e.g. Jorge Ben Jor, Novos Baianos, Milton Nascimento, Djavan, Sergio Mendes, Luiz Melodia)
3. Electronic — house, techno, downtempo, experimental, ambient
4. R&B / soul / neo-soul (e.g. Frank Ocean, Thundercat, Blood Orange)

Your job:
- Pick ONE genre thread that feels fresh relative to the recent playlist names
- Come up with an evocative playlist name (not just the genre name — something atmospheric like "fuzzy & wrecked" or "água e samba")
- Suggest 18 tracks: ~half from artists Big Mike already knows, ~half new discoveries one level under the obvious names
- Skew towards artists currently touring or releasing new music
- Order tracks for good flow: draw in → build → peak → come down
- No two tracks from the same artist back-to-back

Respond with ONLY valid JSON in this exact format, no markdown:
{
  "name": "playlist name",
  "description": "one sentence capturing the vibe",
  "theme": "one word genre bucket: indie|brazilian|electronic|rnb",
  "tracks": [
    { "artist": "Artist Name", "track": "Track Name" }
  ]
}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";

  try {
    return JSON.parse(text) as PlaylistPlan;
  } catch {
    // Strip any markdown if present
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Claude returned unparseable response: ${text}`);
    return JSON.parse(jsonMatch[0]) as PlaylistPlan;
  }
}
