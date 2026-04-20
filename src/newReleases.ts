export interface NewRelease {
  title: string;
  artist: string;
  url: string;
  description: string;
  source: string;
  publishedAt: Date;
}

const SOURCES = [
  { name: "Pitchfork", url: "https://pitchfork.com/rss/reviews/albums/" },
  { name: "Stereogum", url: "https://www.stereogum.com/feed/" },
  { name: "Bandcamp Daily", url: "https://daily.bandcamp.com/feed" },
  { name: "Resident Advisor", url: "https://ra.co/xml/reviews.xml" },
  { name: "Paste", url: "https://www.pastemagazine.com/music/rss/" },
  { name: "Fact", url: "https://www.factmag.com/feed/" },
  { name: "Pigeons & Planes", url: "https://www.complex.com/pigeons-and-planes/rss" },
];

function extractTag(xml: string, tag: string): string {
  const cdataMatch = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`, "i").exec(xml);
  if (cdataMatch) return cdataMatch[1].trim();
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml);
  return match ? match[1].replace(/<[^>]+>/g, "").trim() : "";
}

function parseItems(xml: string, sourceName: string, cutoff: Date): NewRelease[] {
  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const results: NewRelease[] = [];

  for (const block of itemBlocks) {
    const pubDateStr = extractTag(block, "pubDate");
    const publishedAt = pubDateStr ? new Date(pubDateStr) : new Date();
    if (publishedAt < cutoff) continue;

    const rawTitle = extractTag(block, "title");
    const url = extractTag(block, "link") || (/<link>([^<]+)<\/link>/.exec(block)?.[1] ?? "");
    const description = extractTag(block, "description").slice(0, 300);

    // Try to split "Artist: Album" or "Artist - Album" patterns common in review feeds
    let artist = "";
    let title = rawTitle;
    const colonSplit = rawTitle.match(/^(?:Album Review:\s*)?(.+?):\s*(.+)$/i);
    const dashSplit = rawTitle.match(/^(.+?)\s+[–\-]\s+(.+)$/);
    if (colonSplit) {
      artist = colonSplit[1].trim();
      title = colonSplit[2].trim();
    } else if (dashSplit) {
      artist = dashSplit[1].trim();
      title = dashSplit[2].trim();
    }

    results.push({ title, artist, url, description, source: sourceName, publishedAt });
  }

  return results;
}

export async function fetchNewReleases(): Promise<NewRelease[]> {
  const cutoff = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // last 8 days

  const results = await Promise.allSettled(
    SOURCES.map(async ({ name, url }) => {
      const res = await fetch(url, {
        headers: { "User-Agent": "monday-music-bot/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`${name} RSS fetch failed: ${res.status}`);
      const xml = await res.text();
      return parseItems(xml, name, cutoff);
    })
  );

  const releases: NewRelease[] = [];
  for (const [i, result] of results.entries()) {
    if (result.status === "fulfilled") {
      releases.push(...result.value);
      console.log(`  ${SOURCES[i].name}: ${result.value.length} items`);
    } else {
      console.warn(`  ${SOURCES[i].name}: failed (${(result.reason as Error).message})`);
    }
  }

  return releases;
}
