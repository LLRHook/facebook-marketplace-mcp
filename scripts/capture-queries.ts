#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchFacebookBrowser } from "../src/facebook/browser.js";
import { parseCapturedQuery, type CapturedQuery } from "../src/facebook/capture.js";

async function main() {
  const captured = new Map<string, CapturedQuery>();
  const browser = await launchFacebookBrowser();
  try {
    const page = browser.pages()[0] ?? await browser.newPage();
    page.on("request", request => {
      const query = parseCapturedQuery(request.url(), request.postData() ?? "");
      if (query) {
        captured.set(`${query.docId}-${query.operationName}`, query);
        console.log(`Captured ${query.operationName}: ${query.docId}`);
      }
    });
    console.log("Opening the dedicated Facebook profile. Sign in first with npm run login if needed.");
    await page.goto("https://www.facebook.com/marketplace/", { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log("Browse Marketplace for 30 seconds: search, change location, and open a listing.");
    await page.waitForTimeout(30000);
  } finally {
    await browser.close();
  }
  if (captured.size === 0) throw new Error("No Marketplace queries captured. Run npm run login, then retry and browse Marketplace.");
  const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "captured-queries.json");
  fs.writeFileSync(output, JSON.stringify([...captured.values()], null, 2), { mode: 0o600 });
  console.log(`Saved query IDs and complete variables to ${output}. Update src/facebook/queries.ts from this file. It may contain your search terms and location; keep it local.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Query capture failed.");
  process.exitCode = 1;
});
