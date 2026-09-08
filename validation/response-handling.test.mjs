import test from 'node:test';
import assert from 'node:assert/strict';
import { FacebookClient } from '../dist/facebook/client.js';
import { createSearchHandler } from '../dist/tools/search.js';
import { createLocationHandler } from '../dist/tools/location.js';
import { createListingHandler } from '../dist/tools/listing.js';
import { buildSearchVariables } from '../dist/facebook/queries.js';

const args = { query: 'desk', latitude: 40.7128, longitude: -74.0060, radius_km: 50, limit: 1 };
async function withResponse(body, run) {
  // Synthetic protocol responses; no cookies are extracted and no network calls occur.
  const client = new FacebookClient();
  client.session = { cookies: [], cookieHeader: '', userId: 'fixture', fbDtsg: 'fixture', lsd: 'fixture', jazoest: '', clientRevision: '1' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  try { return await run(client); }
  finally { globalThis.fetch = originalFetch; }
}

test('control: a recognized search response produces a listing', async () => {
  const response = { data: { marketplace_search: { feed_units: { edges: [{ node: { listing: { id: 'fixture-1', marketplace_listing_title: 'Fixture desk', listing_price: { formatted_amount: '$20' } } } }], page_info: { has_next_page: false } } } } };
  await withResponse(response, async client => {
    const result = await createSearchHandler(client)(args);
    assert.notEqual(result.isError, true);
    assert.match(result.content[0].text, /Fixture desk/);
  });
});

test('search must report HTTP-200 GraphQL errors as errors', async () => {
  await withResponse({ errors: [{ message: 'Synthetic invalid query ID', code: 1675004 }] }, async client => {
    const result = await createSearchHandler(client)(args);
    assert.equal(result.isError, true, `Actual response: ${result.content[0].text}`);
  });
});

test('location lookup must report HTTP-200 GraphQL errors as errors', async () => {
  await withResponse({ errors: [{ message: 'Synthetic expired session' }] }, async client => {
    const result = await createLocationHandler(client)({ query: 'New York NY' });
    assert.equal(result.isError, true, `Actual response: ${result.content[0].text}`);
  });
});

test('listing detail must reject an HTTP-200 login page', async () => {
  await withResponse('<html><title>Log into Facebook</title><form action="/login/"></form></html>', async client => {
    const result = await createListingHandler(client)({ listing_id: 'fixture-1' });
    assert.equal(result.isError, true, `Actual response: ${result.content[0].text}`);
  });
});

test('a maximum price of zero must stay zero', () => {
  const variables = buildSearchVariables({ query: 'desk', latitude: 40.7128, longitude: -74.0060, radiusKm: 50, limit: 1, maxPrice: 0 });
  assert.equal(variables.params.browse_request_params.filter_price_upper_bound, 0);
});
