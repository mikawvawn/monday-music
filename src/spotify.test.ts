import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeArtist, artistsMatch, isRecentRelease } from "./spotify.js";
import { filterNewsByReleaseArtists, dedupeReleasesByArtist } from "./enrichReleases.js";
import type { CuratedRelease } from "./claude.js";

const mkItem = (artist: string, title: string): CuratedRelease => ({
  artist,
  title,
  blurb: "",
  source: "Test",
  url: `https://example.com/${title.toLowerCase().replace(/\s+/g, "-")}`,
});

test("normalizeArtist: lowercases and strips punctuation", () => {
  assert.equal(normalizeArtist("Björk!"), "bjork");
  assert.equal(normalizeArtist("Tyler, The Creator"), "tylerthecreator");
});

test("normalizeArtist: strips leading 'the'", () => {
  assert.equal(normalizeArtist("The Weeknd"), "weeknd");
  assert.equal(normalizeArtist("Weeknd"), "weeknd");
});

test("normalizeArtist: drops collab suffixes", () => {
  assert.equal(normalizeArtist("Tricky feat. Marta"), "tricky");
  assert.equal(normalizeArtist("Tricky & Guest"), "tricky");
  assert.equal(normalizeArtist("Artist ft. Someone"), "artist");
  assert.equal(normalizeArtist("Drake x Future"), "drake");
});

test("artistsMatch: exact and normalized equality", () => {
  assert.equal(artistsMatch("The Weeknd", "Weeknd"), true);
  assert.equal(artistsMatch("Björk", "BJORK"), true);
  assert.equal(artistsMatch("Tricky", "Tricky & Guest"), true);
});

test("artistsMatch: rejects unrelated artists — the Hooky/ZAMinton case", () => {
  // This is the exact bug reported by the user: searching for Hooky's "World Music"
  // returned ZAMinton's children's album. Must not match.
  assert.equal(artistsMatch("Hooky", "ZAMinton"), false);
  assert.equal(artistsMatch("Boards of Canada", "Some Random Artist"), false);
  assert.equal(artistsMatch("Smerz", "Someone Else"), false);
});

test("artistsMatch: avoids false-positive substring matches on short names", () => {
  // "AJJ" and "AJ" share a substring but are different acts.
  // Short strings (<4 chars) should require exact normalized equality.
  assert.equal(artistsMatch("AJ", "AJJ"), false);
});

test("isRecentRelease: within window", () => {
  const now = new Date("2026-04-22");
  assert.equal(isRecentRelease("2026-04-15", 30, now), true); // 7 days old
  assert.equal(isRecentRelease("2026-04-01", 30, now), true); // 21 days old
  assert.equal(isRecentRelease("2026-04-22", 30, now), true); // same day
});

test("isRecentRelease: outside window", () => {
  const now = new Date("2026-04-22");
  assert.equal(isRecentRelease("2026-03-01", 30, now), false); // 52 days old
  assert.equal(isRecentRelease("1998-01-01", 30, now), false); // ancient (the Boards of Canada case)
  assert.equal(isRecentRelease(null, 30, now), false);
});

test("isRecentRelease: handles partial dates and upcoming", () => {
  const now = new Date("2026-04-22");
  assert.equal(isRecentRelease("2026", 30, now), false); // just year, treated as Jan 1 → old
  assert.equal(isRecentRelease("2026-04", 30, now), true); // YYYY-MM → day defaults to 1
  assert.equal(isRecentRelease("2026-04-25", 30, now), true); // 3 days future (scheduled drop)
});

test("filterNewsByReleaseArtists: drops news whose artist already appears in releases", () => {
  const releases = [mkItem("Alex G", "Headlights"), mkItem("Water From Your Eyes", "Barley")];
  const news = [
    mkItem("Alex G", "Alex G Announces Tour"),         // drop — artist in releases
    mkItem("Mk.gee", "Mk.gee Interview"),              // keep
    mkItem("Wednesday", "Wednesday Signs to XL"),      // keep
  ];
  const out = filterNewsByReleaseArtists(news, releases, 5);
  assert.deepEqual(
    out.map((n) => n.artist),
    ["Mk.gee", "Wednesday"],
  );
});

test("filterNewsByReleaseArtists: normalizes artist names (case, diacritics, leading 'the')", () => {
  const releases = [mkItem("The Weeknd", "Diamond"), mkItem("Björk", "Kvitravn")];
  const news = [
    mkItem("weeknd", "Weeknd launches new app"),      // drop — matches "The Weeknd"
    mkItem("BJORK", "Bjork film retrospective"),      // drop — matches Björk
    mkItem("Caroline Polachek", "Poster Pop Tour"),   // keep
  ];
  const out = filterNewsByReleaseArtists(news, releases, 5);
  assert.deepEqual(out.map((n) => n.artist), ["Caroline Polachek"]);
});

test("filterNewsByReleaseArtists: respects the limit", () => {
  const releases: CuratedRelease[] = [];
  const news = [
    mkItem("A", "a"),
    mkItem("B", "b"),
    mkItem("C", "c"),
    mkItem("D", "d"),
    mkItem("E", "e"),
    mkItem("F", "f"),
  ];
  const out = filterNewsByReleaseArtists(news, releases, 3);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((n) => n.artist), ["A", "B", "C"]);
});

test("dedupeReleasesByArtist: drops extras whose artist is already kept", () => {
  const first = [mkItem("Tricky", "Out Of Place"), mkItem("Smerz", "Easy EP")];
  const extras = [
    mkItem("Tricky", "Different When It's Silent"), // drop — already in first
    mkItem("Alex G", "Headlights"),                 // keep
  ];
  const out = dedupeReleasesByArtist(first, extras);
  assert.deepEqual(out.map((r) => r.artist), ["Tricky", "Smerz", "Alex G"]);
});

test("dedupeReleasesByArtist: no extras is a no-op", () => {
  const first = [mkItem("A", "a"), mkItem("B", "b")];
  const out = dedupeReleasesByArtist(first, []);
  assert.equal(out.length, 2);
});

test("filterNewsByReleaseArtists: no overlap is a no-op", () => {
  const releases = [mkItem("Alex G", "Headlights")];
  const news = [mkItem("Wednesday", "Tour news"), mkItem("Horsegirl", "Horsegirl interview")];
  const out = filterNewsByReleaseArtists(news, releases, 5);
  assert.equal(out.length, 2);
});
