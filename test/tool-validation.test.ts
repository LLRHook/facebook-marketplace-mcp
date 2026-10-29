import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { FacebookClient } from "../src/facebook/client.js";
import { createListingHandler, getListingSchema } from "../src/tools/listing.js";
import { createLocationHandler, searchLocationSchema } from "../src/tools/location.js";
import { monitorSearchSchema } from "../src/tools/monitor.js";

test("listing IDs and location phrases are validated before invoking the client", async () => {
  let calls = 0;
  const client = {
    getListingDetail: async () => { calls++; throw new Error("Client must not run"); },
    searchLocation: async () => { calls++; throw new Error("Client must not run"); },
  } as unknown as FacebookClient;
  for (const listing_id of ["", " ", "123/456", "https://www.facebook.com/marketplace/item/123/", "a".repeat(101)]) {
    const result = await createListingHandler(client)({ listing_id });
    assert.equal(result.isError, true);
    assert.doesNotMatch(result.content[0].text, /Client must not run/);
    assert.equal(z.object(getListingSchema).safeParse({ listing_id }).success, false);
  }
  for (const query of ["", " \t\n", "a".repeat(201)]) {
    const result = await createLocationHandler(client)({ query });
    assert.equal(result.isError, true);
    assert.doesNotMatch(result.content[0].text, /Client must not run/);
    assert.equal(z.object(searchLocationSchema).safeParse({ query }).success, false);
  }
  assert.equal(calls, 0);
});

test("location phrases are trimmed before the request", async () => {
  let requested = "";
  const client = { searchLocation: async (query: string) => { requested = query; return []; } } as unknown as FacebookClient;
  const result = await createLocationHandler(client)({ query: "  New York NY  " });
  assert.notEqual(result.isError, true);
  assert.equal(requested, "New York NY");
});

test("saved-search fields enforce the same numeric and text limits as search_listings", () => {
  const schema = z.object(monitorSearchSchema);
  const valid = { name: "Desk alerts", query: "desk", latitude: 40, longitude: -74 };
  for (const fields of [{ name: " " }, { query: " " }, { latitude: 91 }, { longitude: -181 },
    { radius_km: 0 }, { radius_km: Infinity }, { min_price: -1 }, { max_price: NaN }]) {
    assert.equal(schema.safeParse({ ...valid, ...fields }).success, false, JSON.stringify(fields));
  }
  assert.equal(schema.parse(valid).radius_km, 50);
});
