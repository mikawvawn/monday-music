import { searchAlbumInfo, isRecentRelease, normalizeArtist } from "./spotify.js";
import type { CuratedRelease } from "./claude.js";

const MAX_AGE_DAYS = 30;

export interface EnrichResult {
  kept: CuratedRelease[];
  rejectedUrls: string[];
}

/**
 * Walk candidates in ranked order, validate each against Spotify, keep the first `target` that pass:
 *   1. artist match (validated inside searchAlbumInfo), AND
 *   2. release date within MAX_AGE_DAYS.
 * Stops early once `target` items are kept. Returns the kept items AND the URLs of rejected
 * candidates so the caller can hand them to a retry Claude call if short.
 */
export async function enrichAndFilterReleases(
  candidates: CuratedRelease[],
  token: string,
  target: number
): Promise<EnrichResult> {
  const kept: CuratedRelease[] = [];
  const rejectedUrls: string[] = [];

  for (const release of candidates) {
    if (kept.length >= target) break;
    if (!release.artist && !release.title) continue;

    const info = await searchAlbumInfo(release.artist || release.title, release.title, token).catch(
      () => null
    );
    if (!info || !info.spotifyUrl) {
      console.log(`  ✗ drop "${release.artist} — ${release.title}" (no artist match on Spotify)`);
      rejectedUrls.push(release.url);
      continue;
    }
    if (!isRecentRelease(info.releaseDate, MAX_AGE_DAYS)) {
      console.log(
        `  ✗ drop "${release.artist} — ${release.title}" (matched album from ${info.releaseDate}, older than ${MAX_AGE_DAYS} days)`
      );
      rejectedUrls.push(release.url);
      continue;
    }
    release.imageUrl = info.imageUrl ?? undefined;
    release.spotifyUrl = info.spotifyUrl;
    release.releaseType = info.releaseType ?? undefined;
    console.log(
      `  ✓ keep "${release.artist} — ${release.title}" (${info.releaseType}, ${info.releaseDate})`
    );
    kept.push(release);
  }

  return { kept, rejectedUrls };
}

/**
 * Given already-kept releases + extras from a retry pass, merge them so each artist appears
 * at most once. Preserves the order of `first` (the higher-ranked round-1 picks).
 */
export function dedupeReleasesByArtist(first: CuratedRelease[], extras: CuratedRelease[]): CuratedRelease[] {
  const seen = new Set(first.map((r) => normalizeArtist(r.artist)).filter(Boolean));
  const kept: CuratedRelease[] = [...first];
  for (const r of extras) {
    const key = normalizeArtist(r.artist);
    if (!key || seen.has(key)) {
      console.log(`  ✗ retry-dedupe "${r.artist} — ${r.title}" (artist already kept)`);
      continue;
    }
    seen.add(key);
    kept.push(r);
  }
  return kept;
}

/**
 * Drop news items whose artist already appears in the final list of releases.
 * Keeps the first `limit` news items that survive. Uses normalized artist matching so
 * "The Weeknd" / "Weeknd" / "Björk" / "BJORK" collapse to the same key.
 */
export function filterNewsByReleaseArtists(
  news: CuratedRelease[],
  releases: CuratedRelease[],
  limit: number
): CuratedRelease[] {
  const releaseArtists = new Set(
    releases.map((r) => normalizeArtist(r.artist)).filter((s) => s.length > 0)
  );
  const kept: CuratedRelease[] = [];
  for (const item of news) {
    if (kept.length >= limit) break;
    const key = normalizeArtist(item.artist);
    if (key && releaseArtists.has(key)) {
      console.log(`  ✗ drop news "${item.artist} — ${item.title}" (artist already in New Releases)`);
      continue;
    }
    kept.push(item);
  }
  return kept;
}
