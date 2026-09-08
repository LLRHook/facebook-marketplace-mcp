import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { extractChromeCookies } from "./auth.js";
import type { FacebookCookie } from "./types.js";

export interface SessionCookie {
  domain: string;
  name: string;
  value: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface SavedFacebookSession {
  version: 1;
  userAgent: string;
  cookies: SessionCookie[];
}

export function getSessionFile(env = process.env): string {
  return path.resolve(env.FACEBOOK_SESSION_FILE || path.join(os.homedir(), ".fb-marketplace", "session.json"));
}

export function getLoginProfile(env = process.env): string {
  return path.resolve(env.FACEBOOK_LOGIN_PROFILE || path.join(os.homedir(), ".fb-marketplace", "browser-profile"));
}

export function isFacebookDomain(domain: string): boolean {
  const host = domain.replace(/^\./, "").toLowerCase();
  return host === "facebook.com" || host.endsWith(".facebook.com");
}

export function validateSession(value: unknown): SavedFacebookSession {
  const data = value as Partial<SavedFacebookSession> | null;
  if (!data || data.version !== 1 || typeof data.userAgent !== "string" || !data.userAgent.trim() || /[^\x20-\x7e]/.test(data.userAgent) || !Array.isArray(data.cookies)) {
    throw new Error("Invalid Facebook session file. Run npm run login to replace it.");
  }
  const now = Date.now() / 1000;
  const cookies = data.cookies.filter(cookie => {
    if (!cookie || typeof cookie.domain !== "string" || !isFacebookDomain(cookie.domain)) return false;
    // Only cookies applicable to www.facebook.com/ are sent by the HTTP client.
    const host = cookie.domain.replace(/^\./, "").toLowerCase();
    if (host !== "facebook.com" && host !== "www.facebook.com") return false;
    if (typeof cookie.name !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(cookie.name) || typeof cookie.value !== "string" || /[^\x21-\x3a\x3c-\x7e]/.test(cookie.value)) return false;
    return cookie.path === "/" && typeof cookie.expires === "number" && Number.isFinite(cookie.expires) && (cookie.expires === -1 || cookie.expires > now) && typeof cookie.secure === "boolean" && typeof cookie.httpOnly === "boolean";
  });
  if (!["c_user", "xs"].every(name => cookies.some(cookie => cookie.name === name && cookie.value))) {
    throw new Error("Facebook login is missing or expired. Run npm run login and finish signing in.");
  }
  return { version: 1, userAgent: data.userAgent, cookies };
}

export function saveFacebookSession(file: string, session: SavedFacebookSession): void {
  const validated = validateSession(session);
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(validated, null, 2), { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export async function loadFacebookAuth(options: { chromeProfile?: string; sessionFile?: string; platform?: NodeJS.Platform } = {}): Promise<{ cookies: FacebookCookie[]; userAgent?: string }> {
  const file = options.sessionFile ?? getSessionFile();
  try {
    const session = validateSession(JSON.parse(fs.readFileSync(file, "utf8")));
    return {
      cookies: session.cookies.map(cookie => ({ ...cookie, host: cookie.domain })),
      userAgent: session.userAgent,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (error instanceof SyntaxError) throw new Error("Invalid Facebook session JSON. Run npm run login to replace it.");
      throw error;
    }
  }
  if (!options.sessionFile && !process.env.FACEBOOK_SESSION_FILE && (options.platform ?? process.platform) === "darwin") {
    return { cookies: extractChromeCookies("facebook.com", options.chromeProfile) };
  }
  throw new Error("No saved Facebook session. Run npm run login from the project directory, then retry. Set FACEBOOK_SESSION_FILE if you saved it elsewhere.");
}
