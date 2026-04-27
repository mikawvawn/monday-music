export interface NewRelease {
  title: string;
  artist: string;
  url: string;
  description: string;
  source: string;
  publishedAt: Date;
}

interface SourceConfig {
  name: string;
  url: string;
  includeTitlePatterns?: RegExp[];
  excludeTitlePatterns?: RegExp[];
  includeUrlPatterns?: RegExp[];
  excludeUrlPatterns?: RegExp[];
}

const SOURCES = [
  {
    name: "Pitchfork",
    url: "https://pitchfork.com/feed/feed-album-reviews/rss",
  },
  {
    name: "Stereogum",
    url: "https://www.stereogum.com/feed/",
    includeTitlePatterns: [
      /\breview\b/i,
      /\bnew song\b/i,
      /\bnew album\b/i,
      /\bnew single\b/i,
      /\bEP\b/i,
      /\bmixtape\b/i,
    ],
    excludeTitlePatterns: [/\bannounces? tour\b/i, /\bfestival\b/i, /\blive\b/i, /\bobituary\b/i],
  },
  {
    name: "Bandcamp Daily",
    url: "https://daily.bandcamp.com/feed",
    includeUrlPatterns: [/album-of-the-day/i, /essential-releases/i],
  },
  {
    name: "Resident Advisor",
    url: "https://ra.co/rss/news",
    includeTitlePatterns: [/\bannounces?\b/i, /\breleases?\b/i, /\bnew\b/i, /\bEP\b/i, /\balbum\b/i],
    excludeTitlePatterns: [/\bfestival\b/i, /\bclub guide\b/i],
  },
  { name: "Paste", url: "https://www.pastemagazine.com/music/feed" },
  {
    name: "Fact",
    url: "https://www.factmag.com/feed/",
    includeTitlePatterns: [/\balbum\b/i, /\bEP\b/i, /\bsingle\b/i, /\btrack\b/i],
  },
  {
    name: "Pigeons & Planes",
    url: "https://www.pigeonsandplanes.com/feed/",
    includeTitlePatterns: [/\bnew\b/i, /\brelease\b/i, /\balbum\b/i, /\bEP\b/i, /\bsingle\b/i],
    excludeTitlePatterns: [/\bbest songs?\b/i, /\bplaylist\b/i],
  },
  {
    name: "Brooklyn Vegan",
    url: "https://www.brooklynvegan.com/feed/",
    includeTitlePatterns: [/\bnew\b/i, /\bannounce\b/i, /\balbum\b/i, /\bEP\b/i, /\bsingle\b/i],
    excludeTitlePatterns: [/\btour news\b/i, /\bfavorite songs\b/i, /\bfestival\b/i, /\blive review\b/i],
  },
  {
    name: "Crack Magazine",
    url: "https://crackmagazine.net/feed/",
    includeTitlePatterns: [/\bannounce\b/i, /\bnew\b/i, /\balbum\b/i, /\bEP\b/i, /\bsingle\b/i],
    excludeTitlePatterns: [/\bline-?up\b/i, /\bfestival\b/i],
  },
  {
    name: "The Fader",
    url: "https://www.thefader.com/feed",
    includeTitlePatterns: [/\bnew\b/i, /\brelease\b/i, /\balbum\b/i, /\bEP\b/i, /\bsingle\b/i],
    excludeTitlePatterns: [/\bstyle\b/i, /\bfashion\b/i],
  },
  {
    name: "Line of Best Fit",
    url: "https://www.thelineofbestfit.com/feed",
    includeTitlePatterns: [/\bnew\b/i, /\breview\b/i, /\balbum\b/i, /\bEP\b/i, /\bsingle\b/i],
  },
] satisfies SourceConfig[];

function extractTag(xml: string, tag: string): string {
  const cdataMatch = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`, "i").exec(xml);
  if (cdataMatch) return cdataMatch[1].trim();
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml);
  return match ? match[1].replace(/<[^>]+>/g, "").trim() : "";
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#8216;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8230;/g, "...")
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function splitArtistTitle(rawTitle: string): { artist: string; title: string } {
  // Try to split "Artist: Album" or "Artist - Album" patterns common in review feeds.
  const colonSplit = rawTitle.match(/^(?:Album Review:\s*)?(.+?):\s*(.+)$/i);
  const quotedCommaSplit = rawTitle.match(/^(.+?),\s*["“](.+?)["”]$/);
  const dashSplit = rawTitle.match(/^(.+?)\s+[–\-]\s+(.+)$/);
  if (colonSplit) return { artist: colonSplit[1].trim(), title: colonSplit[2].trim() };
  if (quotedCommaSplit) return { artist: quotedCommaSplit[1].trim(), title: quotedCommaSplit[2].trim() };
  if (dashSplit) return { artist: dashSplit[1].trim(), title: dashSplit[2].trim() };
  return { artist: "", title: rawTitle };
}

function titleCaseFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function enrichArtistTitle(
  sourceName: string,
  url: string,
  rawTitle: string,
  parsed: { artist: string; title: string }
): { artist: string; title: string } {
  let { artist, title } = parsed;

  // "Artist announce(s) new album/EP/single Title"
  if (!artist) {
    const announceMatch = rawTitle.match(
      /^(.+?)\s+announces?\s+new\s+(?:album|record|ep|single)\s+["“]?([^"”]+)["”]?/i
    );
    if (announceMatch) {
      artist = announceMatch[1].trim();
      title = announceMatch[2].trim();
    }
  }

  // Pitchfork review URLs are highly structured: /reviews/albums/{artist}-{album}/
  if (!artist && sourceName === "Pitchfork") {
    const m = url.match(/\/reviews\/albums\/([^/]+)\/?$/i);
    if (m?.[1]) {
      const slug = m[1].toLowerCase();
      const split = slug.match(/^([a-z0-9]+)-(.+)$/);
      if (split) {
        artist = titleCaseFromSlug(split[1]);
        title = titleCaseFromSlug(split[2]);
      }
    }
  }

  // Paste review URLs usually include /music/{artist}/{album-or-topic}
  if (!artist && sourceName === "Paste") {
    const m = url.match(/\/music\/([^/]+)\/([^/?#]+)/i);
    if (m?.[1]) artist = titleCaseFromSlug(m[1]);
  }

  return { artist, title };
}

function shouldKeepItem(source: SourceConfig, title: string, url: string): boolean {
  if (source.includeTitlePatterns && !source.includeTitlePatterns.some((rx) => rx.test(title))) return false;
  if (source.excludeTitlePatterns && source.excludeTitlePatterns.some((rx) => rx.test(title))) return false;
  if (source.includeUrlPatterns && !source.includeUrlPatterns.some((rx) => rx.test(url))) return false;
  if (source.excludeUrlPatterns && source.excludeUrlPatterns.some((rx) => rx.test(url))) return false;
  return true;
}

function parseItems(xml: string, source: SourceConfig, cutoff: Date): NewRelease[] {
  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const results: NewRelease[] = [];

  for (const block of itemBlocks) {
    const pubDateStr = extractTag(block, "pubDate");
    const publishedAt = pubDateStr ? new Date(pubDateStr) : new Date();
    if (publishedAt < cutoff) continue;

    const rawTitle = decodeHtmlEntities(extractTag(block, "title"));
    const url = decodeHtmlEntities(
      extractTag(block, "link") || (/<link>([^<]+)<\/link>/.exec(block)?.[1] ?? "")
    );
    const description = decodeHtmlEntities(extractTag(block, "description")).slice(0, 300);
    if (!rawTitle || !url) continue;
    if (!shouldKeepItem(source, rawTitle, url)) continue;

    const parsed = splitArtistTitle(rawTitle);
    const { artist, title } = enrichArtistTitle(source.name, url, rawTitle, parsed);

    results.push({ title, artist, url, description, source: source.name, publishedAt });
  }

  return results;
}

export async function fetchNewReleases(): Promise<NewRelease[]> {
  const cutoff = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // last 8 days

  const results = await Promise.allSettled(
    SOURCES.map(async (source) => {
      const { name, url } = source;
      const res = await fetch(url, {
        headers: {
          // Many publisher CDNs (Pitchfork, Cloudflare-fronted sites like RA) reject
          // bot-shaped UAs at the edge. Use a real-browser UA so the feed actually loads.
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`${name} source fetch failed: ${res.status}`);
      const xml = await res.text();
      return parseItems(xml, source, cutoff);
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
