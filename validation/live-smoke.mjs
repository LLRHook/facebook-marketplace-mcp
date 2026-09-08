import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = new Client({ name: 'marketplace-live-validation', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/index.js')], cwd: root, env: { ...process.env }, stderr: 'pipe' });
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
  console.log('PASS: authenticated Marketplace search returned listing links.');
  const detail = await call('get_listing', { listing_id: id });
  assert.match(detail, /Price:/);
  console.log('PASS: fetched the details of a listing returned by that search.');
  const location = await call('search_location', { query: 'New York NY' });
  assert.match(location, /lat:/);
  console.log('PASS: location lookup returned coordinates.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await client.close(); }
