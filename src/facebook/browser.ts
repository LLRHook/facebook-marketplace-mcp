import { chromium, type BrowserContext } from "playwright";
import { getLoginProfile } from "./session.js";

export async function launchFacebookBrowser(options: { profile?: string; headless?: boolean; channel?: string } = {}): Promise<BrowserContext> {
  const requested = options.channel ?? process.env.FACEBOOK_BROWSER;
  if (requested && !["chrome", "msedge", "chromium"].includes(requested)) {
    throw new Error("FACEBOOK_BROWSER must be chrome, msedge, or chromium.");
  }
  const channels = requested ? [requested] : ["chrome", "msedge", "chromium"];
  for (const channel of channels) {
    try {
      return await chromium.launchPersistentContext(options.profile ?? getLoginProfile(), {
        channel: channel === "chromium" ? undefined : channel,
        headless: options.headless ?? false,
      });
    } catch (error) {
      // Retry only missing executables. A locked profile needs action, not another browser.
      if (!/executable.*(?:doesn't exist|not found)|distribution.*not found/i.test(String(error))) {
        throw new Error("Could not open the Facebook login browser. Close any other login or capture window using this profile, then retry.");
      }
    }
  }
  throw new Error("No supported browser found. Install Chrome or Edge, or run npx playwright install chromium and set FACEBOOK_BROWSER=chromium.");
}
