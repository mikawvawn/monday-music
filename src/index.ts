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
  type Track,
} from "./spotify.js";
import { generatePlaylist, curateNewReleases, curateMoreReleases } from "./claude.js";
import { sendEmail } from "./email.js";
import { fetchNewReleases } from "./newReleases.js";
import { enrichAndFilterReleases, filterNewsByReleaseArtists, dedupeReleasesByArtist } from "./enrichReleases.js";

const NR_TARGET = 5;
const NEWS_TARGET = 5;

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
  const [plan, curated, artistGenres] = await Promise.all([
    generatePlaylist(recentTracks, topTracks, recentPlaylistNames),
    curateNewReleases(rawReleases, recentArtists, topArtists),
    getTopArtistsWithGenres(token).catch((err) => {
      console.warn("Genre fetch failed (non-fatal):", err.message);
      return {} as Record<string, string[]>;
    }),
  ]);
  console.log(`Playlist: "${plan.name}" (${plan.theme}) | ${plan.tracks.length} tracks suggested`);
  console.log(`Release candidates: ${curated.releases.length} | News candidates: ${curated.news.length}`);

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

  // Validate release candidates against Spotify (artist match + recency). Walk in ranked
  // order, keep first NR_TARGET that pass. If short, retry with additional candidates.
  console.log("Validating release candidates...");
  let { kept: validatedReleases, rejectedUrls } = await enrichAndFilterReleases(
    curated.releases,
    token,
    NR_TARGET,
  );
  if (validatedReleases.length < NR_TARGET) {
    console.log(`Only ${validatedReleases.length}/${NR_TARGET} releases kept — asking Claude for more candidates...`);
    const alreadySeenUrls = [...rejectedUrls, ...validatedReleases.map((r) => r.url)];
    const more = await curateMoreReleases(rawReleases, recentArtists, topArtists, alreadySeenUrls, 10).catch((e) => {
      console.warn(`Retry curation failed: ${e.message}`);
      return [] as typeof curated.releases;
    });
    const needed = NR_TARGET - validatedReleases.length;
    const extra = await enrichAndFilterReleases(more, token, needed);
    validatedReleases = dedupeReleasesByArtist(validatedReleases, extra.kept).slice(0, NR_TARGET);
  }
  if (validatedReleases.length < NR_TARGET) {
    console.warn(`⚠ Only ${validatedReleases.length} releases after retry (target ${NR_TARGET}). Shipping with what we have.`);
  }
  console.log(`Releases final: ${validatedReleases.length}`);

  // Filter News: drop any item whose artist already appears in New Releases. Cap at NEWS_TARGET.
  const news = filterNewsByReleaseArtists(curated.news, validatedReleases, NEWS_TARGET);
  console.log(`News final: ${news.length}`);

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
    validatedReleases,
    news,
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
