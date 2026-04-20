const SPOTIFY_API = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

export interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  url: string;
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
    items: { track: { id: string; name: string; artists: { name: string }[]; album: { name: string }; external_urls: { spotify: string } } }[];
  };
  return data.items.map((i) => ({
    id: i.track.id,
    name: i.track.name,
    artist: i.track.artists[0].name,
    album: i.track.album.name,
    url: i.track.external_urls.spotify,
  }));
}

export async function getTopTracks(token: string): Promise<Track[]> {
  const data = (await spotifyGet("/me/top/tracks?limit=50&time_range=medium_term", token)) as {
    items: { id: string; name: string; artists: { name: string }[]; album: { name: string }; external_urls: { spotify: string } }[];
  };
  return data.items.map((t) => ({
    id: t.id,
    name: t.name,
    artist: t.artists[0].name,
    album: t.album.name,
    url: t.external_urls.spotify,
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
    tracks: { items: { id: string; name: string; artists: { name: string }[]; album: { name: string }; external_urls: { spotify: string } }[] };
  };
  const item = data.tracks.items[0];
  if (!item) return null;
  return {
    id: item.id,
    name: item.name,
    artist: item.artists[0].name,
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
  const res = await fetch(`${SPOTIFY_API}/playlists/${playlistId}/tracks`, {
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
