import { writeFileSync } from "fs";
import {
  getAccessToken,
  getRecentlyPlayed,
  getTopTracks,
  getRecentPlaylists,
  searchTrack,
  getUserId,
  getTopArtistsWithGenres,
  searchAlbumInfo,
  type Track,
} from "./spotify.js";
import { generatePlaylist, curateNewReleases } from "./claude.js";
import { buildEmailHtml } from "./email.js";
import { fetchNewReleases } from "./newReleases.js";

const GENRE_BUCKETS: Record<string, string[]> = {
  Electronic: ["electronic", "house", "techno", "ambient", "downtempo", "experimental", "idm", "glitch", "drone", "synthwave", "electro", "club", "edm"],
  Indie:      ["indie", "shoegaze", "noise", "alternative", "post-rock", "folk", "lo-fi", "dream pop", "art rock", "emo", "grunge"],
  "R&B":      ["r&b", "soul", "funk", "hip hop", "rap", "neo soul", "trap", "pop"],
  Brazilian:  ["mpb", "bossa nova", "samba", "axé", "pagode", "forró", "baile funk", "tropicália"],
};

function computeGenreBreakdown(artistGenres: Record<string, string[]>): { label: string; pct: number }[] {
  const counts: Record<string, number> = { Electronic: 0, Indie: 0, "R&B": 0, Brazilian: 0, Other: 0 };
  const all = Object.values(artistGenres).filter((g): g is string[] => Array.isArray(g));
  if (all.length === 0) return [];
  for (const genres of all) {
    let matched = false;
    for (const [bucket, keywords] of Object.entries(GENRE_BUCKETS)) {
      if (genres.some((g) => keywords.some((k) => g.toLowerCase().includes(k)))) {
        counts[bucket]++;
        matched = true;
        break;
      }
    }
    if (!matched) counts["Other"]++;
  }
  const total = all.length;
  return Object.entries(counts)
    .map(([label, n]) => ({ label, pct: Math.round((n / total) * 100) }))
    .filter((g) => g.pct > 0)
    .sort((a, b) => b.pct - a.pct);
}

async function preview() {
  console.log("Starting preview (no playlist creation)...");

  const token = await getAccessToken();
  console.log("Spotify token obtained");

  const [, recentTracks, topTracks, recentPlaylists, rawReleases] = await Promise.all([
    getUserId(token),
    getRecentlyPlayed(token),
    getTopTracks(token),
    getRecentPlaylists(token),
    fetchNewReleases().then((r) => { console.log(`Fetched ${r.length} releases from RSS`); return r; }),
  ]);

  const recentArtists = [...new Set(recentTracks.map((t) => t.artist))];
  const topArtists = [...new Set(topTracks.map((t) => t.artist))];
  const recentPlaylistNames = recentPlaylists.map((p) => p.name);

  console.log("Asking Claude...");
  const [plan, curatedReleases, artistGenres] = await Promise.all([
    generatePlaylist(recentTracks, topTracks, recentPlaylistNames),
    curateNewReleases(rawReleases, recentArtists, topArtists),
    getTopArtistsWithGenres(token).catch(() => ({} as Record<string, string[]>)),
  ]);
  console.log(`Playlist: "${plan.name}" | Releases: ${curatedReleases.length}`);

  const genreBreakdown = computeGenreBreakdown(artistGenres);

  console.log("Searching Spotify for tracks...");
  const foundTracks: Track[] = [];
  for (const suggestion of plan.tracks) {
    const track = await searchTrack(`${suggestion.track} ${suggestion.artist}`, token);
    if (track) {
      foundTracks.push(track);
      console.log(`  ✓ ${track.artist} — ${track.name}`);
    }
  }

  console.log("Fetching album info...");
  for (const release of curatedReleases) {
    if (release.artist || release.title) {
      const info = await searchAlbumInfo(release.artist || release.title, release.title, token).catch(() => ({ imageUrl: null, spotifyUrl: null }));
      if (info.imageUrl) release.imageUrl = info.imageUrl;
      if (info.spotifyUrl) release.spotifyUrl = info.spotifyUrl;
    }
  }

  const html = buildEmailHtml(
    plan.name,
    plan.description,
    plan.longDescription,
    "https://open.spotify.com/playlist/preview",
    foundTracks,
    curatedReleases,
    topTracks,
    recentTracks,
    genreBreakdown,
  );

  const outPath = "/tmp/monday-music-preview.html";
  writeFileSync(outPath, html);
  console.log(`Preview written to ${outPath}`);
}

preview().catch((err) => {
  console.error("Preview error:", err);
  process.exit(1);
});
