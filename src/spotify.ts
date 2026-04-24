const SPOTIFY_API = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

export interface Track {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  artistIds: string[];
  album: string;
  url: string;
}

export interface ArtistSummary {
  id: string;
  name: string;
  genres: string[];
}

export interface SpotifyClient {
  accessToken: string;
}

export async function getAccessToken(): Promise<string> {
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
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function spotifyGet(path: string, token: string, attempt = 0): Promise<unknown> {
  const res = await fetch(`${SPOTIFY_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 3) throw new Error(`Spotify GET ${path} failed after retries: ${await res.text()}`);
    await sleep((attempt + 1) * 2000);
    return spotifyGet(path, token, attempt + 1);
  }
  if (!res.ok) throw new Error(`Spotify GET ${path} failed: ${await res.text()}`);
  return res.json();
}

export async function getRecentlyPlayed(token: string): Promise<Track[]> {
  const data = (await spotifyGet("/me/player/recently-played?limit=50", token)) as {
    items: { track: { id: string; name: string; artists: { id: string; name: string }[]; album: { name: string }; external_urls: { spotify: string } } }[];
  };
  return data.items.map((i) => ({
    id: i.track.id,
    name: i.track.name,
    artist: i.track.artists[0]?.name ?? "",
    artistId: i.track.artists[0]?.id ?? "",
    artistIds: i.track.artists.map((artist) => artist.id).filter(Boolean),
    album: i.track.album.name,
    url: i.track.external_urls.spotify,
  }));
}

export async function getTopTracks(
  token: string,
  timeRange: "short_term" | "medium_term" | "long_term" = "medium_term",
): Promise<Track[]> {
  const data = (await spotifyGet(`/me/top/tracks?limit=50&time_range=${timeRange}`, token)) as {
    items: { id: string; name: string; artists: { id: string; name: string }[]; album: { name: string }; external_urls: { spotify: string } }[];
  };
  return data.items.map((t) => ({
    id: t.id,
    name: t.name,
    artist: t.artists[0]?.name ?? "",
    artistId: t.artists[0]?.id ?? "",
    artistIds: t.artists.map((artist) => artist.id).filter(Boolean),
    album: t.album.name,
    url: t.external_urls.spotify,
  }));
}

export async function getTopArtists(
  token: string,
  timeRange: "short_term" | "medium_term" | "long_term" = "medium_term",
): Promise<ArtistSummary[]> {
  const data = (await spotifyGet(`/me/top/artists?limit=50&time_range=${timeRange}`, token)) as {
    items: { id: string; name: string; genres: string[] }[];
  };
  return data.items.map((artist) => ({
    id: artist.id,
    name: artist.name,
    genres: artist.genres ?? [],
  }));
}

export async function getArtistsByIds(token: string, artistIds: string[]): Promise<ArtistSummary[]> {
  const ids = [...new Set(artistIds.filter(Boolean))].slice(0, 50);
  if (ids.length === 0) return [];
  const data = (await spotifyGet(`/artists?ids=${encodeURIComponent(ids.join(","))}`, token)) as {
    artists: { id: string; name: string; genres: string[] }[];
  };
  return (data.artists ?? []).map((artist) => ({
    id: artist.id,
    name: artist.name,
    genres: artist.genres ?? [],
  }));
}

export async function getRecentPlaylists(token: string): Promise<{ name: string }[]> {
  const data = (await spotifyGet("/me/playlists?limit=10", token)) as {
    items: { name: string }[];
  };
  return data.items;
}

export async function searchTrack(
  query: string,
  token: string
): Promise<Track | null> {
  const url = `/search?q=${encodeURIComponent(query)}&type=track&limit=1`;
  const data = (await spotifyGet(url, token)) as {
    tracks: { items: { id: string; name: string; artists: { id: string; name: string }[]; album: { name: string }; external_urls: { spotify: string } }[] };
  };
  const item = data.tracks.items[0];
  if (!item) return null;
  return {
    id: item.id,
    name: item.name,
    artist: item.artists[0]?.name ?? "",
    artistId: item.artists[0]?.id ?? "",
    artistIds: item.artists.map((artist) => artist.id).filter(Boolean),
    album: item.album.name,
    url: item.external_urls.spotify,
  };
}

export async function getUserId(token: string): Promise<string> {
  const data = (await spotifyGet("/me", token)) as { id: string };
  return data.id;
}

export async function createPlaylist(
  _userId: string,
  name: string,
  description: string,
  token: string
): Promise<{ id: string; url: string }> {
  const res = await fetch(`${SPOTIFY_API}/me/playlists`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, description, public: false }),
  });
  if (!res.ok) throw new Error(`Create playlist failed: ${await res.text()}`);
  const data = (await res.json()) as { id: string; external_urls: { spotify: string } };
  return { id: data.id, url: data.external_urls.spotify };
}

export async function addTracksToPlaylist(
  playlistId: string,
  trackIds: string[],
  token: string,
  attempt = 0
): Promise<void> {
  const uris = trackIds.map((id) => `spotify:track:${id}`);
  await sleep(1000); // brief pause after playlist creation
  const res = await fetch(`${SPOTIFY_API}/playlists/${encodeURIComponent(playlistId)}/items`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ uris }),
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 3) throw new Error(`Add tracks failed after retries: ${await res.text()}`);
    await sleep((attempt + 1) * 2000);
    return addTracksToPlaylist(playlistId, trackIds, token, attempt + 1);
  }
  if (!res.ok) throw new Error(`Add tracks failed (${res.status}): ${await res.text()}`);
}

/** Fetch user's top artists (medium term) with genre data. Uses user-top-read scope. */
export async function getTopArtistsWithGenres(token: string): Promise<Record<string, string[]>> {
  const data = await getTopArtists(token, "medium_term");
  const result: Record<string, string[]> = {};
  for (const artist of data) {
    result[artist.id] = artist.genres ?? [];
  }
  return result;
}

/** Search Spotify for an album and return the cover art URL (300px preferred). */
export interface AlbumInfo {
  imageUrl: string | null;
  spotifyUrl: string | null;
  releaseType: string | null; // "ALBUM" | "SINGLE" | "EP"
  releaseDate: string | null; // "YYYY-MM-DD" or "YYYY"
  matchedArtist: string | null; // actual artist on the matched Spotify album
}

/** Normalize artist names for comparison: strip "the", punctuation, featuring suffixes, diacritics. */
export function normalizeArtist(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/\s*(feat\.?|featuring|ft\.?|with|&|and|x|vs\.?)\s.*$/i, "") // drop collab suffix
    .replace(/^the\s+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** True if two artist names refer to the same act (normalized equality or one contains the other). */
export function artistsMatch(a: string, b: string): boolean {
  const na = normalizeArtist(a);
  const nb = normalizeArtist(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Tolerate cases like "Tricky" matching "Tricky & Guest" after collab stripping fails
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

interface SpotifyAlbumSearchItem {
  images: { url: string; width: number }[];
  external_urls: { spotify: string };
  album_type: string;
  total_tracks: number;
  release_date: string;
  artists: { name: string }[];
}

function classifyReleaseType(album: SpotifyAlbumSearchItem): string | null {
  const t = album.album_type?.toLowerCase();
  const tracks = album.total_tracks ?? 1;
  if (t === "single" && tracks >= 2) return "EP";
  if (t === "single") return "SINGLE";
  if (t === "album") return "ALBUM";
  if (t === "compilation") return "COMPILATION";
  return null;
}

function pickBestImage(images: { url: string; width: number }[]): string | null {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => Math.abs(a.width - 300) - Math.abs(b.width - 300));
  return sorted[0].url;
}

const EMPTY_INFO: AlbumInfo = {
  imageUrl: null,
  spotifyUrl: null,
  releaseType: null,
  releaseDate: null,
  matchedArtist: null,
};

export async function searchAlbumInfo(
  artist: string,
  title: string,
  token: string
): Promise<AlbumInfo> {
  const q = encodeURIComponent(`${artist} ${title}`);
  const data = (await spotifyGet(`/search?q=${q}&type=album&limit=5`, token)) as {
    albums: { items: SpotifyAlbumSearchItem[] };
  };
  const items = data.albums?.items ?? [];
  if (items.length === 0) return EMPTY_INFO;

  // Find first result whose primary artist matches the expected artist.
  const match = items.find((a) => a.artists?.some((ar) => artistsMatch(ar.name, artist))) ?? null;
  if (!match) return EMPTY_INFO;

  return {
    imageUrl: pickBestImage(match.images),
    spotifyUrl: match.external_urls?.spotify ?? null,
    releaseType: classifyReleaseType(match),
    releaseDate: match.release_date ?? null,
    matchedArtist: match.artists?.[0]?.name ?? null,
  };
}

/** True if a YYYY-MM-DD / YYYY-MM / YYYY date string is within `days` of now. */
export function isRecentRelease(releaseDate: string | null, days: number, now = new Date()): boolean {
  if (!releaseDate) return false;
  // Spotify can return "YYYY", "YYYY-MM", or "YYYY-MM-DD"
  const parts = releaseDate.split("-");
  const y = parseInt(parts[0], 10);
  const m = parts[1] ? parseInt(parts[1], 10) - 1 : 0;
  const d = parts[2] ? parseInt(parts[2], 10) : 1;
  if (!Number.isFinite(y)) return false;
  const released = new Date(Date.UTC(y, m, d));
  const ageDays = (now.getTime() - released.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays <= days && ageDays >= -7; // allow ~1 week in the future for scheduled drops
}

export async function searchAlbumArt(
  artist: string,
  title: string,
  token: string
): Promise<string | null> {
  const { imageUrl } = await searchAlbumInfo(artist, title, token);
  return imageUrl;
}
