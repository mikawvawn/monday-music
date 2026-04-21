import {
  getAccessToken,
  getRecentlyPlayed,
  getTopTracks,
  getRecentPlaylists,
  searchTrack,
  getUserId,
  createPlaylist,
  addTracksToPlaylist,
  getTopArtistsWithGenres,
  searchAlbumInfo,
  type Track,
} from "./spotify.js";
import { generatePlaylist, curateNewReleases } from "./claude.js";
import { sendEmail } from "./email.js";
import { fetchNewReleases } from "./newReleases.js";

// Map Spotify genre tags into 5 display buckets
const GENRE_BUCKETS: Record<string, string[]> = {
  Electronic: ["electronic", "house", "techno", "ambient", "downtempo", "experimental", "idm", "glitch", "drone", "synthwave", "electro", "club", "edm"],
  Indie:      ["indie", "shoegaze", "noise", "alternative", "post-rock", "folk", "lo-fi", "dream pop", "art rock", "emo", "grunge"],
  "R&B":      ["r&b", "soul", "funk", "hip hop", "rap", "neo soul", "trap", "pop"],
  Brazilian:  ["mpb", "bossa nova", "samba", "axé", "pagode", "forró", "baile funk", "tropicália"],
};

function computeGenreBreakdown(
  artistGenres: Record<string, string[]>
): { label: string; pct: number }[] {
  const counts: Record<string, number> = { Electronic: 0, Indie: 0, "R&B": 0, Brazilian: 0, Other: 0 };
  const allArtistGenres = Object.values(artistGenres).filter((g): g is string[] => Array.isArray(g));
  if (allArtistGenres.length === 0) return [];
  for (const genres of allArtistGenres) {
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
  const total = allArtistGenres.length;
  return Object.entries(counts)
    .map(([label, n]) => ({ label, pct: Math.round((n / total) * 100) }))
    .filter((g) => g.pct > 0)
    .sort((a, b) => b.pct - a.pct);
}

async function run() {
  console.log("Starting Monday Music...");

  const token = await getAccessToken();
  console.log("Spotify token obtained");

  // Fetch Spotify data + RSS feeds in parallel
  const [userId, recentTracks, topTracks, recentPlaylists, rawReleases] = await Promise.all([
    getUserId(token),
    getRecentlyPlayed(token),
    getTopTracks(token),
    getRecentPlaylists(token),
    fetchNewReleases().then((r) => { console.log(`Fetched ${r.length} new releases from RSS`); return r; }),
  ]);
  console.log(`Got ${recentTracks.length} recent tracks, ${topTracks.length} top tracks`);

  const recentArtists = [...new Set(recentTracks.map((t) => t.artist))];
  const topArtists = [...new Set(topTracks.map((t) => t.artist))];
  const recentPlaylistNames = recentPlaylists.map((p) => p.name);

  // Claude + genre data in parallel
  console.log("Asking Claude for playlist + new release curation...");
  const [plan, curatedReleases, artistGenres] = await Promise.all([
    generatePlaylist(recentTracks, topTracks, recentPlaylistNames),
    curateNewReleases(rawReleases, recentArtists, topArtists),
    getTopArtistsWithGenres(token).catch((err) => {
      console.warn("Genre fetch failed (non-fatal):", err.message);
      return {} as Record<string, string[]>;
    }),
  ]);
  console.log(`Playlist: "${plan.name}" (${plan.theme}) | ${plan.tracks.length} tracks suggested`);
  console.log(`New releases curated: ${curatedReleases.length}`);

  // Compute genre breakdown from top tracks
  const sampleGenres = Object.entries(artistGenres).slice(0, 3).map(([, gs]) => `[${gs.join(",")}]`).join(" | ");
  console.log(`Artist genres fetched: ${Object.keys(artistGenres).length} artists — sample: ${sampleGenres || "(empty)"}`);
  const genreBreakdown = computeGenreBreakdown(artistGenres);
  console.log(`Genre breakdown: ${genreBreakdown.map((g) => `${g.label} ${g.pct}%`).join(", ") || "(none)"}`);

  // Search Spotify for each playlist track
  console.log("Searching Spotify for tracks...");
  const foundTracks: Track[] = [];
  for (const suggestion of plan.tracks) {
    const track = await searchTrack(`${suggestion.track} ${suggestion.artist}`, token);
    if (track) {
      foundTracks.push(track);
      console.log(`  ✓ ${track.artist} — ${track.name}`);
    } else {
      console.log(`  ✗ Not found: ${suggestion.artist} — ${suggestion.track}`);
    }
  }

  if (foundTracks.length < 5) {
    throw new Error(`Too few tracks found (${foundTracks.length}), aborting`);
  }

  // Enrich releases with album art + Spotify links (sequential to respect rate limits)
  console.log("Fetching album info...");
  for (const release of curatedReleases) {
    if (release.artist || release.title) {
      const info = await searchAlbumInfo(release.artist || release.title, release.title, token).catch(() => ({ imageUrl: null, spotifyUrl: null }));
      if (info.imageUrl) release.imageUrl = info.imageUrl;
      if (info.spotifyUrl) release.spotifyUrl = info.spotifyUrl;
      if (info.imageUrl || info.spotifyUrl) {
        console.log(`  ✓ Info found for: ${release.artist} — ${release.title}`);
      }
    }
  }

  // Create playlist
  const playlist = await createPlaylist(userId, plan.name, plan.description, token);
  await addTracksToPlaylist(playlist.id, foundTracks.map((t) => t.id), token);
  console.log(`Playlist created: ${playlist.url}`);

  // Send email
  await sendEmail(
    plan.name,
    plan.description,
    plan.longDescription,
    playlist.url,
    foundTracks,
    curatedReleases,
    topTracks,
    recentTracks,
    genreBreakdown,
  );

  console.log("Done!");
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
