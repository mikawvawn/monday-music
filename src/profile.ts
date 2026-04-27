import type { ArtistSummary } from "./spotify.js";

export function buildTasteProfile(artists: ArtistSummary[], displayName: string): string {
  if (artists.length === 0) return `${displayName}'s taste: indie, electronic, R&B, world music. Skews underground.`;

  // Spotify deprecated genre data on top-artist responses, so we list artists by name.
  // Claude infers genre context from the artist names themselves.
  const names = artists.map((a) => a.name).join(", ");
  return `${displayName}'s top artists (Spotify medium-term — use these as taste and genre references for blurbs): ${names}. Skews underground — one level under obvious names.`;
}
