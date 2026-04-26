import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, "out");
const outputPath = path.join(outputDir, "spotify-top20-debug.xlsx");

const SPOTIFY_API = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

async function getAccessToken() {
  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } = process.env;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REFRESH_TOKEN) {
    throw new Error("Missing Spotify credentials in environment");
  }

  const creds = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: SPOTIFY_REFRESH_TOKEN,
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function spotifyGet(pathname, token) {
  const res = await fetch(`${SPOTIFY_API}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify GET ${pathname} failed: ${await res.text()}`);
  return res.json();
}

async function getTopArtists(token) {
  const data = await spotifyGet("/me/top/artists?limit=20&time_range=short_term", token);
  return data.items.map((artist, index) => ({
    rank: index + 1,
    artistName: artist.name ?? "",
    artistId: artist.id ?? "",
    genres: artist.genres ?? [],
    popularity: artist.popularity ?? "",
    followers: artist.followers?.total ?? "",
    spotifyUrl: artist.external_urls?.spotify ?? "",
  }));
}

async function getTopTracks(token) {
  const data = await spotifyGet("/me/top/tracks?limit=20&time_range=short_term", token);
  return data.items.map((track, index) => ({
    rank: index + 1,
    trackName: track.name ?? "",
    trackId: track.id ?? "",
    album: track.album?.name ?? "",
    primaryArtist: track.artists?.[0]?.name ?? "",
    primaryArtistId: track.artists?.[0]?.id ?? "",
    allArtistNames: (track.artists ?? []).map((artist) => artist.name ?? ""),
    allArtistIds: (track.artists ?? []).map((artist) => artist.id ?? "").filter(Boolean),
    popularity: track.popularity ?? "",
    spotifyUrl: track.external_urls?.spotify ?? "",
  }));
}

async function getArtistsByIds(token, ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const artists = [];
  for (const id of uniqueIds) {
    try {
      const artist = await spotifyGet(`/artists/${encodeURIComponent(id)}`, token);
      artists.push(artist);
    } catch (error) {
      artists.push({
        id,
        name: "",
        genres: [],
        _lookupError: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return artists;
}

function autosizeColumns(rows) {
  const widths = [];
  for (const row of rows) {
    row.forEach((value, index) => {
      const text = String(value ?? "");
      widths[index] = Math.max(widths[index] ?? 10, Math.min(60, text.length + 2));
    });
  }
  return widths;
}

async function buildWorkbook() {
  const token = await getAccessToken();
  const topArtists = await getTopArtists(token);
  const topTracks = await getTopTracks(token);
  const lookupArtists = await getArtistsByIds(token, topTracks.flatMap((track) => track.allArtistIds));
  const lookupById = Object.fromEntries(lookupArtists.map((artist) => [artist.id, artist]));

  const workbook = Workbook.create();
  const artistSheet = workbook.worksheets.add("Top Artists");
  const trackSheet = workbook.worksheets.add("Top Tracks");
  const notesSheet = workbook.worksheets.add("Notes");

  const artistRows = [
    ["Rank", "Artist", "Artist ID", "Raw Genres JSON", "Genre Count", "Popularity", "Followers", "Spotify URL"],
    ...topArtists.map((artist) => [
      artist.rank,
      artist.artistName,
      artist.artistId,
      JSON.stringify(artist.genres),
      artist.genres.length,
      artist.popularity,
      artist.followers,
      artist.spotifyUrl,
    ]),
  ];

  const trackRows = [
    [
      "Rank",
      "Track",
      "Track ID",
      "Album",
      "Primary Artist",
      "Primary Artist ID",
      "All Artist Names",
      "All Artist IDs",
      "Lookup Artist Names",
      "Lookup Genres JSON By Artist",
      "Flattened Track Genres JSON",
      "Popularity",
      "Spotify URL",
    ],
    ...topTracks.map((track) => {
      const lookedUpArtists = track.allArtistIds.map((id) => lookupById[id]).filter(Boolean);
      const rawGenresByArtist = lookedUpArtists.map((artist) => ({
        artist: artist.name ?? "",
        artistId: artist.id ?? "",
        genres: artist.genres ?? [],
        lookupError: artist._lookupError ?? "",
      }));
      const flattenedGenres = [...new Set(lookedUpArtists.flatMap((artist) => artist.genres ?? []))];
      return [
        track.rank,
        track.trackName,
        track.trackId,
        track.album,
        track.primaryArtist,
        track.primaryArtistId,
        track.allArtistNames.join(" | "),
        track.allArtistIds.join(" | "),
        lookedUpArtists.map((artist) => artist.name ?? "").join(" | "),
        JSON.stringify(rawGenresByArtist),
        JSON.stringify(flattenedGenres),
        track.popularity,
        track.spotifyUrl,
      ];
    }),
  ];

  const noteRows = [
    ["What this workbook shows"],
    ["Top Artists sheet: Spotify /me/top/artists short_term raw genres for the top 20 artists."],
    ["Top Tracks sheet: Spotify /me/top/tracks short_term plus a follow-up /artists lookup for every artist on each top track."],
    ["If Raw Genres JSON is [] or Flattened Track Genres JSON is [], Spotify is not supplying genre metadata for that artist/track context."],
    ["If Flattened Track Genres JSON has values but the donut still fails, the classifier buckets are too narrow rather than the source data being empty."],
  ];

  artistSheet.getRange(`A1:H${artistRows.length}`).values = artistRows;
  trackSheet.getRange(`A1:M${trackRows.length}`).values = trackRows;
  notesSheet.getRange(`A1:A${noteRows.length}`).values = noteRows;

  const artistWidths = autosizeColumns(artistRows);
  const trackWidths = autosizeColumns(trackRows);

  artistWidths.forEach((width, index) => {
    artistSheet.getRange(`${String.fromCharCode(65 + index)}:${String.fromCharCode(65 + index)}`).format.columnWidth = width;
  });
  trackWidths.forEach((width, index) => {
    trackSheet.getRange(`${String.fromCharCode(65 + index)}:${String.fromCharCode(65 + index)}`).format.columnWidth = width;
  });

  artistSheet.getRange("A1:H1").format.font.bold = true;
  trackSheet.getRange("A1:M1").format.font.bold = true;
  notesSheet.getRange("A1").format.font.bold = true;

  await fs.mkdir(outputDir, { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);

  console.log(JSON.stringify({
    outputPath,
    artistCount: topArtists.length,
    trackCount: topTracks.length,
    artistGenreExamples: topArtists.slice(0, 5).map((artist) => ({ artist: artist.artistName, genres: artist.genres })),
    trackGenreExamples: trackRows.slice(1, 6).map((row) => ({ track: row[1], genres: row[10] })),
  }, null, 2));
}

buildWorkbook().catch((error) => {
  console.error(error);
  process.exit(1);
});
