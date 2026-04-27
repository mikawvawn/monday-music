/**
 * Release pipeline debugger.
 *
 * Instruments every stage of the new-release funnel and writes two CSV files:
 *   /tmp/monday-music-debug-candidates-YYYY-MM-DD.csv  — one row per RSS item
 *   /tmp/monday-music-debug-summary-YYYY-MM-DD.csv     — stage-level counts + code refs
 *
 * Run:  npm run debug:releases
 * Env:  same as preview — source .env before running
 */

import { writeFileSync } from "fs";
import { getAccessToken, getTopArtists, searchAlbumInfo, isRecentRelease } from "./spotify.js";
import { curateNewReleases } from "./claude.js";
import { fetchNewReleasesDebug, type NewReleaseDebug } from "./newReleases.js";
import type { CuratedRelease } from "./claude.js";
import { buildTasteProfile } from "./profile.js";

const MAX_AGE_DAYS = 30; // must match enrichReleases.ts

// ─── CSV helpers ────────────────────────────────────────────────────────────

function csvCell(val: string | number | boolean | undefined | null): string {
  const s = val == null ? "" : String(val);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function csvRow(cells: (string | number | boolean | undefined | null)[]): string {
  return cells.map(csvCell).join(",");
}

function writeCsv(path: string, headers: string[], rows: (string | number | boolean | undefined | null)[][]): void {
  const lines = [headers.join(","), ...rows.map(csvRow)].join("\n");
  writeFileSync(path, lines, "utf8");
}

// ─── Stage result types ──────────────────────────────────────────────────────

interface CandidateRow {
  // RSS
  source: string;
  publishedAt: string;
  rawTitle: string;
  extractedArtist: string;
  extractedTitle: string;
  url: string;
  rssPass: "Y" | "N";
  rssFilterReason: string;
  // Claude
  sentToClaude: "Y" | "N";
  claudeProposed: "Y" | "N";
  claudeRank: number | "";
  claudeBlurb: string;
  sourceCapResult: "kept" | "capped" | "n/a";
  // Spotify
  spotifySearched: "Y" | "N";
  spotifyMatch: "matched" | "no_match" | "skipped";
  spotifyMatchedArtist: string;
  spotifyAlbum: string;
  spotifyUrl: string;
  releaseDate: string;
  ageDays: number | "";
  recencyCheck: "pass" | "fail" | "skipped";
  // Final
  finalStatus: string;
  codeRef: string;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function debug() {
  const dateTag = new Date().toISOString().slice(0, 10);
  const candidatePath = `/tmp/monday-music-debug-candidates-${dateTag}.csv`;
  const summaryPath = `/tmp/monday-music-debug-summary-${dateTag}.csv`;

  console.log("Monday Music — Release Pipeline Debugger");
  console.log("=========================================\n");

  // ── Stage 1: RSS fetch ───────────────────────────────────────────────────
  console.log("Stage 1: Fetching RSS feeds (14-day window)...");
  const token = await getAccessToken();
  const [allItems, topArtistsMedium] = await Promise.all([
    fetchNewReleasesDebug(14),
    getTopArtists(token, "medium_term").catch(() => []),
  ]);
  const tasteProfile = buildTasteProfile(topArtistsMedium, "Mike");
  console.log(`  Taste profile built from ${topArtistsMedium.length} top artists`);

  const rssTotal = allItems.length;
  const rssKept = allItems.filter((i) => i.kept);
  const rssDropped = allItems.filter((i) => !i.kept);
  console.log(`  Total items in window: ${rssTotal}`);
  console.log(`  Kept by source filter: ${rssKept.length}`);
  console.log(`  Dropped by source filter: ${rssDropped.length}`);

  // Per-source breakdown
  const sourceCounts = new Map<string, { total: number; kept: number }>();
  for (const item of allItems) {
    const c = sourceCounts.get(item.source) ?? { total: 0, kept: 0 };
    c.total++;
    if (item.kept) c.kept++;
    sourceCounts.set(item.source, c);
  }
  for (const [src, c] of sourceCounts) {
    console.log(`    ${src}: ${c.kept}/${c.total} kept`);
  }

  // ── Stage 2: Claude curation ─────────────────────────────────────────────
  console.log("\nStage 2: Claude curation...");
  const recentArtists = rssKept.map((i) => i.artist).filter(Boolean);
  const topArtists = topArtistsMedium.map((a) => a.name);

  const curated = await curateNewReleases(rssKept as any, recentArtists, topArtists, tasteProfile);

  const claudeRaw = curated.releases;
  console.log(`  Claude proposed: ${claudeRaw.length} release candidates`);

  // Build a URL→index map for Claude proposals (before cap)
  // We need to call the internal capItemsPerSource — replicate its logic here to
  // see what got capped.
  const sourceCapCounts = new Map<string, number>();
  const postCap: CuratedRelease[] = [];
  const cappedItems: CuratedRelease[] = [];
  for (const item of claudeRaw) {
    const key = item.source?.trim() || "Unknown";
    const count = sourceCapCounts.get(key) ?? 0;
    if (count >= 3) {
      cappedItems.push(item);
    } else {
      postCap.push(item);
      sourceCapCounts.set(key, count + 1);
    }
  }
  console.log(`  After per-source cap (max 3): ${postCap.length} candidates`);
  if (cappedItems.length > 0) {
    console.log(`  Capped: ${cappedItems.map((i) => `${i.artist} — ${i.title}`).join(", ")}`);
  }

  // ── Stage 3: Spotify validation ──────────────────────────────────────────
  console.log("\nStage 3: Spotify validation...");

  interface SpotifyResult {
    candidate: CuratedRelease;
    spotifyMatch: "matched" | "no_match";
    matchedArtist: string;
    albumTitle: string;
    spotifyUrl: string;
    releaseDate: string;
    ageDays: number | null;
    recency: "pass" | "fail";
    kept: boolean;
    dropReason: string;
  }

  const spotifyResults: SpotifyResult[] = [];
  for (const candidate of postCap) {
    const info = await searchAlbumInfo(candidate.artist || candidate.title, candidate.title, token).catch(() => null);
    if (!info || !info.spotifyUrl) {
      spotifyResults.push({
        candidate, spotifyMatch: "no_match", matchedArtist: "", albumTitle: "", spotifyUrl: "",
        releaseDate: "", ageDays: null, recency: "fail", kept: false,
        dropReason: "no Spotify artist match",
      });
      console.log(`  ✗ ${candidate.artist} — ${candidate.title}: no Spotify match`);
      continue;
    }

    const ageDays = info.releaseDate
      ? Math.round((Date.now() - new Date(info.releaseDate).getTime()) / 86400000)
      : null;
    const recent = isRecentRelease(info.releaseDate, MAX_AGE_DAYS);

    spotifyResults.push({
      candidate,
      spotifyMatch: "matched",
      matchedArtist: info.matchedArtist ?? "",
      albumTitle: candidate.title,
      spotifyUrl: info.spotifyUrl ?? "",
      releaseDate: info.releaseDate ?? "",
      ageDays,
      recency: recent ? "pass" : "fail",
      kept: recent,
      dropReason: recent ? "" : `release date ${info.releaseDate} is older than ${MAX_AGE_DAYS} days`,
    });

    const icon = recent ? "✓" : "✗";
    console.log(`  ${icon} ${candidate.artist} — ${candidate.title}: ${info.releaseDate ?? "unknown date"} (${ageDays ?? "?"}d old)`);
  }

  const spotifyKept = spotifyResults.filter((r) => r.kept);
  const spotifyDropped = spotifyResults.filter((r) => !r.kept);
  console.log(`\n  Kept: ${spotifyKept.length} | Dropped: ${spotifyDropped.length}`);

  // ── Build candidate rows ─────────────────────────────────────────────────
  const claudeUrlSet = new Set(claudeRaw.map((c) => c.url));
  const postCapUrlSet = new Set(postCap.map((c) => c.url));
  const spotifyResultMap = new Map(spotifyResults.map((r) => [r.candidate.url, r]));
  const claudeRankMap = new Map(claudeRaw.map((c, i) => [c.url, i + 1]));
  const claudeBlurbMap = new Map(claudeRaw.map((c) => [c.url, c.blurb]));

  const rows: CandidateRow[] = allItems.map((item): CandidateRow => {
    const inClaude = claudeUrlSet.has(item.url);
    const inPostCap = postCapUrlSet.has(item.url);
    const spotResult = spotifyResultMap.get(item.url);
    const rank = claudeRankMap.get(item.url);

    let finalStatus = "";
    let codeRef = "";

    if (!item.kept) {
      finalStatus = "✗ dropped — RSS filter";
      codeRef = "newReleases.ts → shouldKeepItem()";
    } else if (!inClaude) {
      finalStatus = "✗ not proposed by Claude";
      codeRef = "claude.ts → curateNewReleases()";
    } else if (!inPostCap) {
      finalStatus = "✗ dropped — per-source cap";
      codeRef = "claude.ts → capItemsPerSource(max=3)";
    } else if (!spotResult) {
      finalStatus = "✗ not reached Spotify";
      codeRef = "enrichReleases.ts → enrichAndFilterReleases()";
    } else if (spotResult.spotifyMatch === "no_match") {
      finalStatus = "✗ dropped — no Spotify match";
      codeRef = "spotify.ts → searchAlbumInfo() → artistsMatch()";
    } else if (spotResult.recency === "fail") {
      finalStatus = "✗ dropped — release too old";
      codeRef = `enrichReleases.ts → isRecentRelease(MAX_AGE_DAYS=${MAX_AGE_DAYS})`;
    } else {
      finalStatus = "✓ kept";
      codeRef = "";
    }

    return {
      source: item.source,
      publishedAt: item.publishedAt.toISOString().slice(0, 10),
      rawTitle: item.rawTitle,
      extractedArtist: item.artist,
      extractedTitle: item.title,
      url: item.url,
      rssPass: item.kept ? "Y" : "N",
      rssFilterReason: item.filterReason ?? "",
      sentToClaude: item.kept ? "Y" : "N",
      claudeProposed: inClaude ? "Y" : "N",
      claudeRank: rank ?? "",
      claudeBlurb: claudeBlurbMap.get(item.url) ?? "",
      sourceCapResult: !inClaude ? "n/a" : inPostCap ? "kept" : "capped",
      spotifySearched: inPostCap ? "Y" : "N",
      spotifyMatch: spotResult?.spotifyMatch ?? "skipped",
      spotifyMatchedArtist: spotResult?.matchedArtist ?? "",
      spotifyAlbum: spotResult?.albumTitle ?? "",
      spotifyUrl: spotResult?.spotifyUrl ?? "",
      releaseDate: spotResult?.releaseDate ?? "",
      ageDays: spotResult?.ageDays ?? "",
      recencyCheck: spotResult ? spotResult.recency : "skipped",
      finalStatus,
      codeRef,
    };
  });

  // Sort: kept first, then by stage dropped
  const statusOrder = (s: string) => {
    if (s.startsWith("✓")) return 0;
    if (s.includes("too old")) return 1;
    if (s.includes("Spotify")) return 2;
    if (s.includes("per-source")) return 3;
    if (s.includes("Claude")) return 4;
    return 5;
  };
  rows.sort((a, b) => statusOrder(a.finalStatus) - statusOrder(b.finalStatus));

  // ── Write candidates CSV ─────────────────────────────────────────────────
  const candidateHeaders = [
    "SOURCE", "PUBLISHED", "RAW_TITLE", "EXTRACTED_ARTIST", "EXTRACTED_TITLE", "URL",
    "RSS_PASS", "RSS_FILTER_REASON",
    "SENT_TO_CLAUDE", "CLAUDE_PROPOSED", "CLAUDE_RANK", "CLAUDE_BLURB",
    "SOURCE_CAP",
    "SPOTIFY_SEARCHED", "SPOTIFY_MATCH", "SPOTIFY_MATCHED_ARTIST", "SPOTIFY_ALBUM",
    "SPOTIFY_URL", "RELEASE_DATE", "AGE_DAYS", "RECENCY_CHECK",
    "FINAL_STATUS", "CODE_REF",
  ];
  const candidateData = rows.map((r) => [
    r.source, r.publishedAt, r.rawTitle, r.extractedArtist, r.extractedTitle, r.url,
    r.rssPass, r.rssFilterReason,
    r.sentToClaude, r.claudeProposed, r.claudeRank, r.claudeBlurb,
    r.sourceCapResult,
    r.spotifySearched, r.spotifyMatch, r.spotifyMatchedArtist, r.spotifyAlbum,
    r.spotifyUrl, r.releaseDate, r.ageDays, r.recencyCheck,
    r.finalStatus, r.codeRef,
  ]);
  writeCsv(candidatePath, candidateHeaders, candidateData);

  // ── Write summary CSV ────────────────────────────────────────────────────
  const summaryHeaders = ["STAGE", "ITEMS_IN", "ITEMS_OUT", "DROPPED", "NOTES", "CODE_REF"];
  const summaryData: (string | number)[][] = [
    [
      "RSS date window",
      rssTotal + rssDropped.length, // approximate — we can't see pre-date-cutoff items
      rssTotal,
      "?",
      "14-day lookback window",
      "newReleases.ts:fetchNewReleases() cutoff",
    ],
    [
      "RSS source filter (shouldKeepItem)",
      rssTotal,
      rssKept.length,
      rssDropped.length,
      "Per-source include/exclude title and URL patterns",
      "newReleases.ts → shouldKeepItem()",
    ],
    [
      "Claude curation",
      rssKept.length,
      claudeRaw.length,
      rssKept.length - claudeRaw.length,
      "Claude picks releases fitting taste profile; max 15",
      "claude.ts → curateNewReleases()",
    ],
    [
      "Per-source cap",
      claudeRaw.length,
      postCap.length,
      cappedItems.length,
      "Max 3 candidates per publication before Spotify validation",
      "claude.ts → capItemsPerSource(max=3)",
    ],
    [
      "Spotify artist match",
      postCap.length,
      spotifyResults.filter((r) => r.spotifyMatch === "matched").length,
      spotifyResults.filter((r) => r.spotifyMatch === "no_match").length,
      "searchAlbumInfo() must find album with matching artist",
      "spotify.ts → searchAlbumInfo() → artistsMatch()",
    ],
    [
      `Recency check (≤${MAX_AGE_DAYS}d)`,
      spotifyResults.filter((r) => r.spotifyMatch === "matched").length,
      spotifyKept.length,
      spotifyDropped.filter((r) => r.spotifyMatch === "matched").length,
      `Release date must be within ${MAX_AGE_DAYS} days`,
      `enrichReleases.ts → isRecentRelease(MAX_AGE_DAYS=${MAX_AGE_DAYS})`,
    ],
    [
      "Final kept",
      spotifyKept.length,
      spotifyKept.length,
      0,
      "Target = 5; retry triggered if short",
      "preview.ts / index.ts → NR_TARGET",
    ],
  ];
  writeCsv(summaryPath, summaryHeaders, summaryData);

  // ── Console summary ──────────────────────────────────────────────────────
  console.log("\n── Summary ─────────────────────────────────────────────────");
  console.log(`  RSS items in window       : ${rssTotal}`);
  console.log(`  Passed source filter      : ${rssKept.length}`);
  console.log(`  Claude proposed           : ${claudeRaw.length}`);
  console.log(`  After per-source cap      : ${postCap.length}`);
  console.log(`  Spotify matched           : ${spotifyResults.filter((r) => r.spotifyMatch === "matched").length}`);
  console.log(`  Passed recency (≤${MAX_AGE_DAYS}d)    : ${spotifyKept.length}  ← final new releases count`);
  console.log();
  console.log(`  Candidates CSV : ${candidatePath}`);
  console.log(`  Summary CSV    : ${summaryPath}`);
  console.log("────────────────────────────────────────────────────────────");
}

debug().catch((err) => {
  console.error("Debug run failed:", err);
  process.exit(1);
});
