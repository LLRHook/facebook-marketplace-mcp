import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
async function check(name, run) {
  try {
    const evidence = await run();
    results.push({ name, passed: true, evidence });
  } catch (error) {
    results.push({ name, passed: false, evidence: error.message });
  }
  console.log(JSON.stringify(results.at(-1)));
}
function content(result) {
  return result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
}
async function connect(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [path.join(root, 'dist/index.js')],
    cwd: root, env: { ...process.env, ...env }, stderr: 'pipe',
  });
  const client = new Client({ name: 'marketplace-validation', version: '1.0.0' });
  await client.connect(transport, { timeout: 10000 });
  return client;
}

// Isolate all monitor and authentication state from the user's home and browser.
const temporaryHome = await fs.mkdtemp(path.join(os.tmpdir(), 'marketplace-validation-'));
const storageEnv = { USERPROFILE: temporaryHome, HOME: temporaryHome, FACEBOOK_SESSION_FILE: path.join(temporaryHome, 'missing-session.json') };
let local;
try {
  local = await connect(storageEnv);
  await check('MCP initialization and tool discovery', async () => {
    const names = (await local.listTools()).tools.map(tool => tool.name).sort();
    assert.deepEqual(names, ['check_monitors', 'delete_monitor', 'get_listing', 'list_monitors', 'monitor_search', 'search_listings', 'search_location']);
    return names;
  });
  await check('create a monitor', async () => {
    const result = await local.callTool({ name: 'monitor_search', arguments: { name: 'validation-only', query: 'desk', latitude: 40.7128, longitude: -74.0060 } });
    assert.notEqual(result.isError, true, content(result));
    assert.match(content(result), /saved/);
    assert.equal(JSON.parse(await fs.readFile(path.join(temporaryHome, '.fb-marketplace/monitors.json'), 'utf8')).length, 1);
    return 'Saved into an isolated temporary home';
  });
  await check('duplicate monitor rejected', async () => {
    const result = await local.callTool({ name: 'monitor_search', arguments: { name: 'validation-only', query: 'desk', latitude: 40.7128, longitude: -74.0060 } });
    assert.equal(result.isError, true);
    assert.match(content(result), /already exists/);
    return content(result);
  });
  await local.close();
  local = await connect(storageEnv);
  await check('monitor persists across server restart', async () => {
    const result = await local.callTool({ name: 'list_monitors', arguments: {} });
    assert.match(content(result), /validation-only/);
    return 'The restarted MCP server read the saved monitor';
  });
  await check('delete monitor and confirm empty storage', async () => {
    const result = await local.callTool({ name: 'delete_monitor', arguments: { name: 'validation-only' } });
    assert.match(content(result), /deleted/);
    const listed = await local.callTool({ name: 'list_monitors', arguments: {} });
    assert.match(content(listed), /No monitors saved/);
    return 'Temporary monitor deleted';
  });
  await check('check_monitors handles empty storage', async () => {
    const result = await local.callTool({ name: 'check_monitors', arguments: {} });
    assert.notEqual(result.isError, true);
    assert.match(content(result), /No monitors saved/);
    return content(result);
  });
  for (const [name, args] of [
    ['search_listings', { query: 'desk', latitude: 40.7128, longitude: -74.0060, limit: 1 }],
    ['search_location', { query: 'New York NY' }],
    ['get_listing', { listing_id: '0' }],
  ]) {
    await check(`${name}: missing session gives an actionable MCP error`, async () => {
      const result = await local.callTool({ name, arguments: args }, undefined, { timeout: 10000 });
      assert.equal(result.isError, true);
      assert.match(content(result), /npm run login/);
      return content(result);
    });
  }
} finally {
  await local?.close();
  const resolved = await fs.realpath(temporaryHome);
  const tempRoot = await fs.realpath(os.tmpdir());
  if (path.dirname(resolved).toLowerCase() !== tempRoot.toLowerCase() || !path.basename(resolved).startsWith('marketplace-validation-')) throw new Error('Unexpected temporary cleanup path');
  await fs.rm(resolved, { recursive: true, force: true });
}

await fs.writeFile(path.join(root, 'validation/smoke-results.json'), JSON.stringify({ node: process.version, platform: process.platform, results }, null, 2));
console.log(`${results.filter(r => r.passed).length}/${results.length} checks passed`);
process.exitCode = results.some(r => !r.passed) ? 1 : 0;
