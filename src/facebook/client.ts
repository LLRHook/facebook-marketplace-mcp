import type {
  FacebookSession,
  SearchParams,
  SearchResult,
  MarketplaceListingDetail,
} from "./types.js";
import { cookiesToHeader, getCookieValue } from "./auth.js";
import { loadFacebookAuth } from "./session.js";
import {
  MARKETPLACE_SEARCH_DOC_ID,
  LOCATION_SEARCH_DOC_ID,
  LISTING_DETAIL_DOC_ID,
  buildSearchVariables,
  buildLocationSearchVariables,
} from "./queries.js";
import {
  parseSearchResponse,
  parseListingDetailFromPage,
  parseListingDetailResponse,
  parseLocationResponse,
} from "./parser.js";
import { RateLimiter } from "../utils/rate-limit.js";

const GRAPHQL_URL = "https://www.facebook.com/api/graphql/";
const MARKETPLACE_URL = "https://www.facebook.com/marketplace/";
// Legacy macOS cookie extraction has no browser UA. Saved sessions supply their own.
const LEGACY_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const BROWSER_HEADERS: Record<string, string> = {
  "Accept-Language": "en-US,en;q=0.9",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "Upgrade-Insecure-Requests": "1",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class FacebookClient {
  private session: FacebookSession | null = null;
  private rateLimiter: RateLimiter;
  private reqCounter = 0;
  private chromeProfile: string;
  private userAgent = LEGACY_USER_AGENT;
  private requestTimeoutMs: number;

  constructor(
    options: {
      maxRequestsPerMinute?: number;
      chromeProfile?: string;
      requestTimeoutMs?: number;
    } = {}
  ) {
    this.rateLimiter = new RateLimiter(options.maxRequestsPerMinute ?? 3);
    this.chromeProfile = options.chromeProfile ?? "Default";
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    if (!Number.isInteger(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new Error("Request timeout must be a positive integer.");
    }
  }

  async ensureSession(): Promise<FacebookSession> {
    if (this.session) return this.session;
    return this.initSession();
  }

  async initSession(): Promise<FacebookSession> {
    const { cookies, userAgent } = await loadFacebookAuth({
      chromeProfile: this.chromeProfile,
    });
    this.userAgent = userAgent ?? LEGACY_USER_AGENT;
    if (cookies.length === 0) {
      throw new Error("No Facebook session cookies found. Run npm run login.");
    }
    const userId = getCookieValue(cookies, "c_user");
    if (!userId) {
      throw new Error("No active Facebook user cookie found. Run npm run login.");
    }
    const cookieHeader = cookiesToHeader(cookies);
    const tokens = await this.extractTokens(cookieHeader);
    this.session = { cookies, cookieHeader, userId, ...tokens };
    return this.session;
  }

  private async fetchFacebook(
    url: string,
    options: RequestInit,
  ): Promise<{ response: Response; text: string }> {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      // Keep the deadline active while receiving the response body too.
      return { response, text: await response.text() };
    } catch {
      throw new Error("Facebook request failed or timed out. Try again later.");
    }
  }

  private async extractTokens(cookieHeader: string): Promise<{
    fbDtsg: string;
    lsd: string;
    jazoest: string;
    clientRevision: string;
  }> {
    await this.rateLimiter.wait();
    const { response: res, text: html } = await this.fetchFacebook(MARKETPLACE_URL, {
      headers: {
        ...BROWSER_HEADERS,
        "User-Agent": this.userAgent,
        Cookie: cookieHeader,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch Marketplace page (HTTP ${res.status}).`);
    }
    const dtsgMatch =
      html.match(/"DTSGInitData"\s*,\s*\[\]\s*,\s*\{"token"\s*:\s*"([^"]+)"/) ??
      html.match(/"DTSGInitialData"\s*,\s*\[\]\s*,\s*\{"token"\s*:\s*"([^"]+)"/) ??
      html.match(/"dtsg"\s*:\s*\{"token"\s*:\s*"([^"]+)"/);
    if (!dtsgMatch) {
      throw new Error("Could not initialize Marketplace. The session may be expired or access blocked; run npm run login.");
    }
    const jazoestMatch = html.match(/jazoest=(\d+)/);
    const lsdMatch = html.match(/"LSD"\s*,\s*\[\]\s*,\s*\{"token"\s*:\s*"([^"]+)"/) ??
      html.match(/name="lsd"\s+value="([^"]+)"/);
    const revMatch = html.match(/"client_revision"\s*:\s*(\d+)/) ??
      html.match(/__spin_r:\s*(\d+)/);
    return {
      fbDtsg: dtsgMatch[1],
      lsd: lsdMatch?.[1] ?? "",
      jazoest: jazoestMatch?.[1] ?? "",
      clientRevision: revMatch?.[1] ?? "1",
    };
  }

  private async graphqlRequest(
    docId: string,
    variables: Record<string, unknown>
  ): Promise<unknown> {
    const session = await this.ensureSession();
    await this.rateLimiter.wait();
    this.reqCounter++;
    const body = new URLSearchParams({
      fb_dtsg: session.fbDtsg,
      lsd: session.lsd,
      jazoest: session.jazoest,
      doc_id: docId,
      variables: JSON.stringify(variables),
      __a: "1",
      __req: this.reqCounter.toString(36),
      __rev: session.clientRevision,
    });
    const { response: res, text } = await this.fetchFacebook(GRAPHQL_URL, {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "User-Agent": this.userAgent,
        Cookie: session.cookieHeader,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "*/*",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        Origin: "https://www.facebook.com",
        Referer: MARKETPLACE_URL,
        "X-FB-LSD": session.lsd,
      },
      body: body.toString(),
    });
    if (res.status === 401 || res.status === 403) {
      this.session = null;
      throw new Error("Session expired or access blocked. Run npm run login.");
    }
    if (!res.ok) {
      throw new Error(`GraphQL request failed (HTTP ${res.status}).`);
    }
    let data: unknown;
    try {
      // Only remove Facebook's known prefix, never arbitrary HTML before a brace.
      data = JSON.parse(text.replace(/^\s*for\s*\(;;\);\s*/, ""));
    } catch {
      throw new Error("Facebook returned an invalid GraphQL response. Its query format may have changed.");
    }
    if (!isObject(data)) {
      throw new Error("Facebook returned an invalid GraphQL response envelope.");
    }
    const hasErrors = Array.isArray(data.errors) ? data.errors.length > 0 : Boolean(data.errors);
    if (hasErrors || data.error) {
      this.session = null;
      throw new Error("Facebook returned GraphQL errors. The session or query IDs may need refreshing.");
    }
    if (!isObject(data.data)) {
      throw new Error("Facebook returned GraphQL data in an unrecognized format.");
    }
    return data;
  }

  async searchListings(params: SearchParams): Promise<SearchResult> {
    const data = await this.graphqlRequest(MARKETPLACE_SEARCH_DOC_ID, buildSearchVariables(params));
    return parseSearchResponse(data);
  }

  async getListingDetail(listingId: string): Promise<MarketplaceListingDetail> {
    if (LISTING_DETAIL_DOC_ID) {
      const data = await this.graphqlRequest(LISTING_DETAIL_DOC_ID, { targetId: listingId });
      return parseListingDetailResponse(data, listingId);
    }
    const session = await this.ensureSession();
    await this.rateLimiter.wait();
    const url = `https://www.facebook.com/marketplace/item/${encodeURIComponent(listingId)}/`;
    const { response: res, text: html } = await this.fetchFacebook(url, {
      headers: {
        ...BROWSER_HEADERS,
        "User-Agent": this.userAgent,
        Cookie: session.cookieHeader,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch listing (HTTP ${res.status}).`);
    }
    return parseListingDetailFromPage(html, listingId);
  }

  async searchLocation(
    query: string
  ): Promise<Array<{ name: string; latitude: number; longitude: number }>> {
    const data = await this.graphqlRequest(LOCATION_SEARCH_DOC_ID, buildLocationSearchVariables(query));
    return parseLocationResponse(data);
  }

  clearSession() {
    this.session = null;
    this.reqCounter = 0;
  }
}
