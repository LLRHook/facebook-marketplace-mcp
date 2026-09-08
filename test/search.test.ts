import test from "node:test";
import assert from "node:assert/strict";
import { createSearchHandler } from "../src/tools/search.js";
import { analyzePrice, distanceKm } from "../src/facebook/listing-analysis.js";
import { buildSearchVariables } from "../src/facebook/queries.js";
import type { MarketplaceListing, SearchParams } from "../src/facebook/types.js";

const input = { query: "cards", latitude: 0, longitude: 0 };
const listing = (id: string, props: Partial<MarketplaceListing> = {}): MarketplaceListing => ({
  id, title: "Cards", price: "$200", priceAmount: 200, location: "Town", imageUrl: "",
  sellerName: "Seller", postedDate: "", url: `https://www.facebook.com/marketplace/item/${id}/`,
  isPending: false, ...props,
});
const handler = (listings: MarketplaceListing[]) => createSearchHandler({ searchListings: async () => ({
  listings, hasNextPage: true, endCursor: "next-page",
}) });

test("search exposes pagination without dropping a server page larger than requested", async () => {
  let requested: SearchParams | undefined;
  const search = createSearchHandler({ searchListings: async params => {
    requested = params;
    return { listings: [listing("a"), listing("b"), listing("b")], hasNextPage: true, endCursor: "page-three" };
  } });
  const result = await search({ ...input, radius_miles: 250, cursor: "page-two", limit: 1, delivery: "local_pickup" });
  assert.equal(requested?.cursor, "page-two");
  assert.equal(requested?.radiusKm, 402.336);
  assert.equal(requested?.delivery, "local_pickup");
  assert.equal(result.structuredContent?.returnedCount, 2);
  assert.equal(result.structuredContent?.excluded.duplicate, 1);
  assert.equal(result.structuredContent?.endCursor, "page-three");
  assert.equal(result.structuredContent?.facebookRadiusKm, 403);
  assert.match(result.content[0].text, /all rows were processed/);
});

test("an ineligible duplicate cannot hide a later eligible copy", async () => {
  const result = await handler([listing("a"), listing("a", { latitude: 0, longitude: 0 }), listing("a")])({ ...input, strict_radius: true });
  assert.equal(result.structuredContent?.returnedCount, 1);
  assert.equal(result.structuredContent?.listings[0].straightLineDistanceKm, 0);
  assert.equal(result.structuredContent?.excluded.duplicate, 1);
});

test("known out-of-radius results are excluded and unknown distance stays explicitly unknown", async () => {
  const result = await handler([
    listing("near", { latitude: 0, longitude: 0.1 }),
    listing("far", { latitude: 0, longitude: 10 }), listing("unknown"),
  ])({ ...input, radius_km: 50 });
  assert.deepEqual(result.structuredContent?.listings.map(row => row.id), ["near", "unknown"]);
  assert.equal(result.structuredContent?.excluded.outsideRadius, 1);
  assert.equal(result.structuredContent?.listings[1].straightLineDistanceKm, null);
  assert.match(result.content[0].text, /not confirmed within the radius/);
});

test("previously seen IDs can be excluded across queries while preserving continuation", async () => {
  const result = await handler([listing("old"), listing("new")])({ ...input, exclude_ids: ["old"] });
  assert.deepEqual(result.structuredContent?.listings.map(row => row.id), ["new"]);
  assert.equal(result.structuredContent?.excluded.duplicate, 1);
  assert.equal(result.structuredContent?.paginationStatus, "more_results");
  const empty = await handler([listing("old")])({ ...input, exclude_ids: ["old"] });
  assert.equal(empty.structuredContent?.returnedCount, 0);
  assert.match(empty.content[0].text, /bounded continuation/);
});

test("a repeated cursor is flagged instead of recommending an endless replay", async () => {
  const result = await handler([])({ ...input, cursor: "next-page" });
  assert.equal(result.structuredContent?.paginationStatus, "stalled");
  assert.match(result.content[0].text, /Stop rather than repeating/);
  assert.doesNotMatch(result.content[0].text, /Next page cursor/);
});

test("strict radius can empty a page without hiding its continuation or claiming no local inventory", async () => {
  const result = await handler([listing("unknown"), listing("invalid", { latitude: Infinity, longitude: 0 })])({ ...input, strict_radius: true });
  assert.equal(result.structuredContent?.returnedCount, 0);
  assert.equal(result.structuredContent?.excluded.unknownDistance, 2);
  assert.equal(result.structuredContent?.hasNextPage, true);
  assert.match(result.content[0].text, /does not establish that no nearby listings exist/);
  assert.match(result.content[0].text, /next-page/);
});

test("age and availability filters distinguish known age from missing or future dates", async () => {
  const rows = [listing("old", { postedDate: "2000-01-01T00:00:00Z" }),
    listing("recent", { postedDate: new Date(Date.now() - 1000).toISOString() }),
    listing("unknown"), listing("future", { postedDate: "2999-01-01T00:00:00Z" }),
    listing("pending", { isPending: true }), listing("sold", { isSold: true })];
  const loose = await handler(rows)({ ...input, max_age_days: 1 });
  assert.deepEqual(loose.structuredContent?.listings.map(row => row.id), ["recent", "unknown", "future"]);
  const strict = await handler(rows)({ ...input, max_age_days: 1, include_unknown_dates: false });
  assert.deepEqual(strict.structuredContent?.listings.map(row => row.id), ["recent"]);
  const pending = await handler(rows)({ ...input, include_pending: true });
  assert.ok(pending.structuredContent?.listings.some(row => row.id === "pending"));
  assert.ok(!pending.structuredContent?.listings.some(row => row.id === "sold"));
});

test("invalid search ranges and units fail before any network call", async () => {
  const search = createSearchHandler({ searchListings: async () => { throw new Error("Network must not run"); } });
  for (const invalid of [{ radius_km: 2, radius_miles: 2 }, { min_price: 10, max_price: 0 },
    { query: " " }, { latitude: 91 }, { limit: 1.5 }, { radius_miles: -1 },
    { radius_miles: Number.MAX_VALUE }, { max_price: Number.MAX_VALUE }]) {
    const result = await search({ ...input, ...invalid });
    assert.equal(result.isError, true);
    assert.doesNotMatch(result.content[0].text, /Network must not run/);
  }
});

test("delivery selection preserves both defaults and changes only the selected flags", () => {
  const variables = (delivery?: SearchParams["delivery"]) => buildSearchVariables({
    ...input, radiusKm: 50, limit: 24, delivery,
  }) as any;
  assert.equal(variables().params.browse_request_params.commerce_enable_shipping, true);
  assert.equal(variables("local_pickup").params.browse_request_params.commerce_enable_shipping, false);
  assert.equal(variables("shipping").params.browse_request_params.commerce_enable_local_pickup, false);
  const rounded = buildSearchVariables({ ...input, radiusKm: 402.336, limit: 24, minPrice: 2.55 }) as any;
  assert.equal(rounded.params.browse_request_params.filter_radius_km, 403);
  assert.equal(rounded.params.browse_request_params.filter_price_lower_bound, 255);
  assert.throws(() => buildSearchVariables({ ...input, radiusKm: Infinity, limit: 24 }));
  assert.throws(() => buildSearchVariables({ ...input, radiusKm: 50, limit: 24, maxPrice: Number.MAX_VALUE }));
});

test("price review exposes multiple prices without replacing the headline or asserting a bundle total", () => {
  const review = analyzePrice(listing("mixed", { price: "$150", priceAmount: 150 }), "$235 for all, or $85 and $75 each. $235 firm.");
  assert.equal(review.headlineAmount, 150);
  assert.deepEqual(review.descriptionAmounts, [235, 85, 75]);
  assert.match(review.warnings.join(" "), /may price separate items or bundles/);
  assert.equal(analyzePrice(listing("zero", { priceAmount: 0 })).warnings.length, 1);
  assert.equal(analyzePrice(listing("unknown", { price: "N/A", priceAmount: null })).headlineAmount, null);
  assert.equal(analyzePrice(listing("overflow", { price: `$${"9".repeat(400)}`, priceAmount: null })).headlineAmount, null);
  assert.equal(analyzePrice(listing("normal"), "$200 for this binder with 90 cards.").warnings.length, 0);
  assert.deepEqual(analyzePrice(listing("shorthand"), "Asking $2k or $2 k; $1.234,56 abroad, $250.50 here.").descriptionAmounts, [250.5]);
});

test("straight-line distance handles the same point and the antimeridian", () => {
  assert.equal(distanceKm(39, -77, 39, -77), 0);
  assert.ok(Math.abs(distanceKm(0, 179.9, 0, -179.9) - 22.239) < 0.01);
});
