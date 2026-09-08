import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserContext } from "playwright";
import { launchFacebookBrowser } from "./browser.js";
import { getSessionFile, saveFacebookSession, validateSession } from "./session.js";

export function isMainModule(url: string, entry = process.argv[1]): boolean {
  return !!entry && url === pathToFileURL(path.resolve(entry)).href;
}

export async function runFacebookLogin(options: {
  sessionFile?: string;
  timeoutMs?: number;
  launch?: () => Promise<BrowserContext>;
  log?: (message: string) => void;
} = {}): Promise<string> {
  const log = options.log ?? console.log;
  const sessionFile = options.sessionFile ?? getSessionFile();
  const context = await (options.launch ?? launchFacebookBrowser)();
  let closed = false;
  context.on("close", () => { closed = true; });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    log("Sign into Facebook in the browser window and complete any verification. Open Marketplace when ready; the session will be saved automatically.");
    await page.goto("https://www.facebook.com/marketplace/", { waitUntil: "domcontentloaded", timeout: 60000 });
    const deadline = Date.now() + (options.timeoutMs ?? 10 * 60 * 1000);
    while (!closed && Date.now() < deadline) {
      const activePage = context.pages().find(candidate => {
        const url = new URL(candidate.url());
        return url.hostname === "www.facebook.com" && url.pathname.startsWith("/marketplace");
      }) ?? page;
      const current = new URL(activePage.url());
      if (current.hostname === "www.facebook.com" && current.pathname.startsWith("/marketplace")) {
        const cookies = await context.cookies("https://www.facebook.com/");
        let userAgent;
        try { userAgent = await activePage.evaluate(() => navigator.userAgent); }
        catch (error) {
          if (!/execution context was destroyed|cannot find context|has been closed/i.test(String(error))) throw error;
          // Navigation can replace the execution context between reading the URL and UA.
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        let session;
        try { session = validateSession({ version: 1, cookies, userAgent }); }
        catch { /* The user has not finished login yet. */ }
        if (session) {
          saveFacebookSession(sessionFile, session);
          log(`Facebook session saved to ${sessionFile}. You can now start the MCP server.`);
          return sessionFile;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(closed ? "Login browser closed before a Facebook session was saved." : "Login timed out. Run npm run login to try again.");
  } finally {
    await context.close();
  }
}

if (isMainModule(import.meta.url)) {
  if (process.argv.includes("--help")) {
    console.log("Usage: npm run login\nOpens a dedicated Facebook browser profile. Sign in and open Marketplace to save the session.\nEnvironment: FACEBOOK_SESSION_FILE, FACEBOOK_LOGIN_PROFILE, FACEBOOK_BROWSER (chrome, msedge, chromium).");
  } else {
    runFacebookLogin().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Facebook login could not finish. Run npm run login to try again.");
      process.exitCode = 1;
    });
  }
}
