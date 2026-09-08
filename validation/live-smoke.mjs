import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = new Client({ name: 'marketplace-live-validation', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/index.js')], cwd: root, env: { ...process.env }, stderr: 'pipe' });
const evidence = { checkedAt: new Date().toISOString(), node: process.version, platform: process.platform, checks: [] };
function passed(check, detail) {
  evidence.checks.push({ check, passed: true, ...detail });
  console.log(`PASS: ${check}`);
}
function text(result) { return result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'); }
async function call(name, args) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  assert.notEqual(result.isError, true, text(result));
  return text(result);
}
try {
  await client.connect(transport);
  const search = await call('search_listings', { query: 'desk', latitude: 40.7128, longitude: -74.0060, limit: 3 });
  const id = search.match(/marketplace\/item\/(\d+)\//)?.[1];
  assert.ok(id, `Live search returned no verifiable listing: ${search}`);
  const selected = search.match(/1\. \*\*([^\n]+)\*\* — ([^\n]+)/);
  assert.ok(selected, 'Search result is missing its title or price.');
  passed('authenticated Marketplace search returned listing links', { listingLinks: [...search.matchAll(/marketplace\/item\/(\d+)\//g)].length });
  const detail = await call('get_listing', { listing_id: id });
  const detailTitle = detail.match(/^# (.+)/)?.[1];
  const detailPrice = detail.match(/\*\*Price:\*\* ([^\n]+)/)?.[1];
  assert.equal(detailTitle, selected[1], 'Detail title does not match the selected search result.');
  assert.ok(detailPrice && detailPrice !== 'N/A', 'Listing detail has no usable price.');
  assert.equal(detailPrice, selected[2], 'Detail price differs from the selected search result; the listing may have changed.');
  assert.ok(detail.includes(`/marketplace/item/${id}/`), 'Detail link must retain the selected public ID.');
  const imageCount = Number(detail.match(/\*\*Images:\*\* (\d+)/)?.[1] ?? 0);
  const hasDescription = detail.includes('## Description\n');
  assert.ok(imageCount > 0 || hasDescription, 'Listing detail has neither images nor description.');
  passed('listing details match the search title, price and public URL', { imageCount, hasDescription });
  const location = await call('search_location', { query: 'New York NY' });
  const coordinates = [...location.matchAll(/lat: (-?\d+(?:\.\d+)?), lng: (-?\d+(?:\.\d+)?)/g)].map(match => ({ latitude: Number(match[1]), longitude: Number(match[2]) }));
  assert.ok(coordinates.some(point => Math.abs(point.latitude - 40.7128) < 1 && Math.abs(point.longitude + 74.0060) < 1), 'Location lookup did not include coordinates near New York City.');
  passed('location lookup returned coordinates near New York City', { locations: coordinates.length });
} catch (error) {
  console.error(error.message);
  evidence.checks.push({ check: 'live validation', passed: false, error: error.message });
  process.exitCode = 1;
} finally {
  await client.close();
  fs.writeFileSync(path.join(root, 'validation/live-results.json'), JSON.stringify(evidence, null, 2));
}
