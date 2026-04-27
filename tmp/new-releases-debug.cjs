const { fetchNewReleases } = require("../dist/newReleases.js");
const { curateNewReleases } = require("../dist/claude.js");
const { enrichAndFilterReleases } = require("../dist/enrichReleases.js");
const { getAccessToken, getRecentlyPlayed, getTopTracks } = require("../dist/spotify.js");

function formatRow(ranking, title, artist, source, spotifyUrl) {
  return `${String(ranking).padStart(2, " ")} | ${title} | ${artist} | ${source} | ${spotifyUrl}`;
}

async function run() {
  console.log("=== New Releases Debug Run ===");
  const token = await getAccessToken();
  const [rawReleases, recentTracks, topTracks] = await Promise.all([
    fetchNewReleases(),
    getRecentlyPlayed(token),
    getTopTracks(token),
  ]);

  const recentArtists = [...new Set(recentTracks.map((t) => t.artist))];
  const topArtists = [...new Set(topTracks.map((t) => t.artist))];

  console.log(`Fetched releases from sources: ${rawReleases.length}`);
  console.log("Sample fetched items (first 20):");
  rawReleases.slice(0, 20).forEach((r, idx) => {
    console.log(formatRow(idx + 1, r.title, r.artist, r.source, "-"));
  });

  const curated = await curateNewReleases(rawReleases, recentArtists, topArtists);
  console.log(`\nClaude release candidates: ${curated.releases.length}`);
  console.log("Ranked release candidates:");
  curated.releases.forEach((r, idx) => {
    console.log(formatRow(idx + 1, r.title, r.artist, r.source, r.spotifyUrl ?? "-"));
  });

  const enriched = await enrichAndFilterReleases(curated.releases, token, curated.releases.length);
  const rankByUrl = new Map(curated.releases.map((r, idx) => [r.url, idx + 1]));

  console.log(`\nValidated candidates (with Spotify): ${enriched.kept.length}`);
  console.log("Ranking | Album title | Artist | Source | Spotify link");
  enriched.kept.forEach((r) => {
    const ranking = rankByUrl.get(r.url) ?? -1;
    console.log(formatRow(ranking, r.title, r.artist, r.source, r.spotifyUrl ?? "-"));
  });
}

run().catch((err) => {
  console.error("Debug run failed:", err);
  process.exit(1);
});
