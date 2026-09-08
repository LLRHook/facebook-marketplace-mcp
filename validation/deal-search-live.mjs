import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = new Client({ name: 'deal-search-live-validation', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/index.js')], cwd: root, env: { ...process.env }, stderr: 'pipe' });
const evidence = { checkedAt: new Date().toISOString(), node: process.version, platform: process.platform, checks: [], samples: {} };
const base = { query: 'pokemon binder', latitude: 39.0062, longitude: -77.4286, radius_miles: 250, limit: 24 };
async function call(name, args) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  assert.notEqual(result.isError, true, result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'));
  assert.ok(result.structuredContent, 'Expected structured MCP output');
  return result.structuredContent;
}
function passed(name, facts) {
  const check = { name, passed: true, ...facts };
  evidence.checks.push(check);
  console.log(JSON.stringify(check));
}
try {
  await client.connect(transport);
  const first = await call('search_listings', base);
  assert.equal(first.radiusKm, 402.336);
  assert.equal(first.facebookRadiusKm, 403);
  assert.ok(first.listings.length > 0, 'Live query has no usable listings');
  assert.ok(first.listings.every(row => row.priceAmount === null || typeof row.priceAmount === 'number'));
  evidence.samples.first = first;
  passed('250-mile search sends a whole-km radius and returns structured results', {
    received: first.receivedCount, returned: first.returnedCount,
    unknownDistance: first.listings.filter(row => row.distanceStatus === 'unknown').length,
  });
  const local = await call('search_listings', { ...base, delivery: 'local_pickup' });
  evidence.samples.local = local;
  assert.ok(local.hasNextPage && local.endCursor, 'Live sample did not offer pagination');
  passed('Facebook accepts local-pickup request flags', { received: local.receivedCount,
    deliveryTypesObserved: [...new Set(local.listings.flatMap(row => row.deliveryTypes))] });
  const next = await call('search_listings', { ...base, delivery: 'local_pickup', cursor: local.endCursor,
    exclude_ids: local.listings.map(row => row.id) });
  const oldIds = new Set(local.listings.map(row => row.id));
  const novel = next.listings.filter(row => !oldIds.has(row.id));
  evidence.samples.next = next;
  assert.equal(novel.length, next.listings.length, 'Previously seen IDs leaked through the local exclusion filter');
  assert.ok(['end', 'stalled', 'more_results'].includes(next.paginationStatus));
  if (next.hasNextPage && next.endCursor === local.endCursor) assert.equal(next.paginationStatus, 'stalled');
  passed('Continuation preserves server status and excludes prior IDs', { received: next.receivedCount, newIds: novel.length,
    paginationStatus: next.paginationStatus, limitation: novel.length === 0 ? 'This continuation produced no new retained IDs; it does not verify additional inventory coverage.' : null });
  const deal = await call('calculate_trip_deal', { asking_price: 200, estimated_value: 381.73, round_trip_miles: 65.72696701264614 });
  assert.equal(deal.trip_deal.fuel_cost, 9.39);
  passed('MCP calculator handles the researched Woodbridge road distance', { acquisition: deal.trip_deal.cash_fuel_acquisition_cost });
  for (const id of ['37710689515242797', '28741997435386118']) {
    const detail = await call('get_listing', { listing_id: id });
    assert.equal(detail.listing.id, id);
    assert.ok(detail.listing.description);
    evidence.samples[id] = detail;
    if (id === '37710689515242797') assert.ok(detail.priceReview.warnings.length > 0, 'Expected the known multiple-price description to trigger review');
    passed('Full listing detail includes structured price review', { id, price: detail.listing.price, priceWarnings: detail.priceReview.warnings.length, sold: detail.listing.isSold, pending: detail.listing.isPending });
  }
} catch (error) {
  evidence.checks.push({ name: 'live validation', passed: false, error: error.message });
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.close();
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  await fs.writeFile(path.join(root, '.local/deal-search-live.json'), JSON.stringify(evidence, null, 2));
}
