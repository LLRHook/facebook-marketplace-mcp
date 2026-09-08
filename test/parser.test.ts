import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSearchResponse,
  parseLocationResponse,
  parseListingDetailFromPage,
  parseListingDetailResponse,
} from "../src/facebook/parser.js";

const listing = {
  id: "123",
  marketplace_listing_title: "Desk",
  listing_price: { formatted_amount_zeros_stripped: "$20" },
};
const edge = { node: { listing } };
const page = (payload: unknown) =>
  `<script type='application/json'>${JSON.stringify(payload)}</script>`;

test("search handles moved listing connections and preserves valid entries", () => {
  const result = parseSearchResponse({ data: { viewer: { new_feed: {
    edges: [null, { node: { id: "story" } }, edge],
    page_info: { has_next_page: true, end_cursor: "page-two" },
  } } } });
  assert.equal(result.listings.length, 1);
  assert.equal(result.listings[0].price, "$20");
  assert.equal(result.hasNextPage, true);
  assert.equal(result.endCursor, "page-two");
});

test("search distinguishes a recognized empty feed from unknown or malformed data", () => {
  assert.deepEqual(parseSearchResponse({ data: { marketplace_search: { feed_units: {
    edges: [], page_info: { has_next_page: false },
  } } } }).listings, []);
  for (const response of [
    {},
    { errors: [{ message: "invalid query" }] },
    { data: { unexpected: [] } },
    { data: { marketplace_search: { feed_units: { edges: "bad" } } } },
    { data: { marketplace_search: { feed_units: { edges: [{ node: { id: "story" } }] } } } },
  ]) assert.throws(() => parseSearchResponse(response));
});

test("search recognizes Facebook's explicit no-results story", () => {
  const result = parseSearchResponse({ data: { viewer: {
    story: { __typename: "EntMarketplaceSearchFeedNoResults" },
  } } });
  assert.equal(result.listings.length, 0);
});

test("malformed optional dates do not discard a valid listing", () => {
  const result = parseSearchResponse({ data: { marketplace_search: { feed_units: {
    edges: [{ node: { ...listing, creation_time: 1e100 } }],
  } } } });
  assert.equal(result.listings.length, 1);
  assert.equal(result.listings[0].postedDate, "");
});

test("location responses require real coordinates and a recognized connection", () => {
  const result = parseLocationResponse({ data: { city_street_search: { street_results: {
    edges: [null, { node: { single_line_address: "New York", location: {
      latitude: 40.71, longitude: -74.01,
    } } }],
  } } } });
  assert.deepEqual(result, [{ name: "New York", latitude: 40.71, longitude: -74.01 }]);
  assert.throws(() => parseLocationResponse({ data: {} }));
  assert.throws(() => parseLocationResponse({ data: { city_street_search: {
    street_results: { edges: [{ node: { single_line_address: "Missing coordinates" } }] },
  } } }));
});

test("listing details merge only the requested listing's fragments", () => {
  const html = page({ related: {
    id: "456", marketplace_listing_title: "Wrong desk",
    listing_price: { formatted_amount: "$999" },
    marketplace_listing_seller: { name: "Wrong seller" },
  } }) + page({ target: listing }) + page({ target: {
    id: "123",
    redacted_description: { text: "Target description" },
    marketplace_listing_seller: { id: "789", name: "Target seller" },
    listing_photos: [{ image: { uri: "https://example.com/one.jpg" } },
      { image: { uri: "https://example.com/two.jpg" } }],
    location_text: { text: "Brooklyn" },
    condition_text: { text: "Used - good" },
    is_pending: true,
  } });
  const detail = parseListingDetailFromPage(html, "123");
  assert.equal(detail.title, "Desk");
  assert.equal(detail.price, "$20");
  assert.equal(detail.description, "Target description");
  assert.equal(detail.seller.name, "Target seller");
  assert.equal(detail.seller.profileUrl, "https://www.facebook.com/789");
  assert.equal(detail.location, "Brooklyn");
  assert.equal(detail.condition, "Used - good");
  assert.equal(detail.isPending, true);
  assert.equal(detail.images.length, 2);
});

test("listing parser rejects login pages and unrelated listings", () => {
  assert.throws(() => parseListingDetailFromPage(
    '<html><title>Log into Facebook</title><form action="/login/"></form></html>', "123"));
  assert.throws(() => parseListingDetailFromPage(
    '<meta property="og:title" content="Facebook">' + page(listing), "456"));
});

test("an incomplete target never borrows fields from a neighboring listing", () => {
  const detail = parseListingDetailFromPage(page({ data: [
    { id: "456", marketplace_listing_title: "Other", listing_price: { amount: "999" },
      marketplace_listing_seller: { name: "Other seller" } },
    { id: "123", marketplace_listing_title: "Target" },
  ] }), "123");
  assert.equal(detail.price, "N/A");
  assert.equal(detail.seller.name, "");
});

test("GraphQL listing details use the same target-specific normalization", () => {
  assert.equal(parseListingDetailResponse({ data: { node: listing } }, "123").title, "Desk");
  assert.throws(() => parseListingDetailResponse({ data: { node: listing } }, "456"));
});
