# Facebook Marketplace MCP Server

An MCP server for reading Facebook Marketplace through its internal GraphQL requests. This fork adds Windows and Linux login support, keeps the macOS login fallback, and reports Facebook failures explicitly.

## How It Works

Facebook's web client sends Marketplace queries to `POST /api/graphql/` with a `doc_id` and `variables`. Run `npm run login` once to sign into Facebook in a dedicated browser profile. The server then uses the saved Facebook cookies and browser user agent for HTTP requests. It does not need an open browser during searches.

The query updates use the community capture from [upstream PR #3](https://github.com/jdcodes1/facebook-marketplace-mcp/pull/3), reported on August 28, 2026. Facebook can change these queries; passing local tests does not establish live Marketplace access.

## Prerequisites

- Windows, macOS, or Linux
- Node.js 20+; CI tests Node 22 and 24
- Chrome or Edge, or Playwright Chromium
- A Facebook account with access to Marketplace

## Installation

```bash
git clone https://github.com/LLRHook/facebook-marketplace-mcp.git
cd facebook-marketplace-mcp
npm ci --omit=optional
npm run build
npm run login
```

These commands work in PowerShell. Sign into Facebook in the browser window, complete any verification, and open Marketplace. The login command saves the session automatically and closes that browser window. Your regular Chrome profile is not used.

By default, login tries Chrome, then Edge, then Playwright Chromium if an executable is missing. To use Chromium explicitly:

```powershell
npx playwright install chromium
$env:FACEBOOK_BROWSER = "chromium"
npm run login
```

The session is stored at `%USERPROFILE%\.fb-marketplace\session.json` on Windows and `~/.fb-marketplace/session.json` on macOS/Linux. The dedicated browser profile is beside it in `browser-profile`. The session file contains login credentials in plaintext; keep it private and out of source control. Windows access follows the folder's inherited permissions. On macOS/Linux, newly created session files request owner-only permissions.

To retain the original automatic Chrome/Keychain extraction on macOS, use `npm ci` to install the optional SQLite dependency. The server uses this fallback only when no default session file exists and `FACEBOOK_SESSION_FILE` is unset.

## Setup with Claude Code

```bash
claude mcp add facebook-marketplace -- node /path/to/facebook-marketplace-mcp/dist/index.js
```

For a Windows MCP client, use an absolute path to the built server:

```json
{
  "mcpServers": {
    "facebook-marketplace": {
      "command": "node",
      "args": ["C:/src/facebook-marketplace-mcp/dist/index.js"]
    }
  }
}
```

Replace `C:/src/facebook-marketplace-mcp` with your checkout path. Login and the MCP server must run as the same Windows user, or both must set `FACEBOOK_SESSION_FILE` to the same absolute file. The default session location does not depend on the client's working directory.

## Tools

### `search_listings`
Search Marketplace by query, location, and filters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search term |
| `latitude` | number | yes | Latitude of search center |
| `longitude` | number | yes | Longitude of search center |
| `radius_km` | number | no | Search radius (default: 50) |
| `min_price` | number | no | Min price in dollars |
| `max_price` | number | no | Max price in dollars |
| `category` | string | no | Category ID |
| `limit` | number | no | Max results (default: 20) |

### `get_listing`
Get full details for a specific listing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `listing_id` | string | yes | Marketplace listing ID |

### `search_location`
Look up a city or town to obtain coordinates for `search_listings`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | City/town name, such as `New York NY` |

### `monitor_search`
Save a search as a monitor to track new listings over time.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Monitor name |
| `query` | string | yes | Search term |
| `latitude` | number | yes | Search center lat |
| `longitude` | number | yes | Search center lng |
| `radius_km` | number | no | Radius (default: 50) |
| `min_price` | number | no | Min price |
| `max_price` | number | no | Max price |

### `check_monitors`
Check monitors for new listings since last check.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `monitor_name` | string | no | Check specific monitor, or omit for all |

### `list_monitors`
List all saved monitors.

### `delete_monitor`
Delete a saved monitor.

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `FACEBOOK_SESSION_FILE` | `~/.fb-marketplace/session.json` | Session path used by both login and server. Use an absolute path for MCP clients. |
| `FACEBOOK_LOGIN_PROFILE` | `~/.fb-marketplace/browser-profile` | Dedicated browser profile used by login and query capture. |
| `FACEBOOK_BROWSER` | Chrome, then Edge, then Chromium | Select `chrome`, `msedge`, or `chromium`. |
| `CHROME_PROFILE` | `Default` | Chrome profile name for the legacy macOS fallback only. |

## Updating GraphQL Queries

Facebook rotates their `doc_id` values on deploys. If searches stop working:

```bash
npm run capture-queries
```

Close any login window first. This opens the dedicated profile for 30 seconds. Search, change location, and open listings to capture relevant query IDs and complete variables in the ignored `captured-queries.json`. It excludes authentication form fields and redacts token-like fields inside variables. Captures can still include search terms and location; keep them local. Update `src/facebook/queries.ts` using the captured request shape as well as its ID.

## Testing

```powershell
npm test
npm run test:browser
```

`npm test` builds the server, runs synthetic response and session regressions, and exercises the actual MCP subprocess with isolated monitor storage. It makes no Facebook requests and works without the optional SQLite module. `test:browser` checks a real installed browser, persistent profile, and session round-trip with fixture cookies in temporary storage; it also makes no Facebook requests.

After logging in, run `npm run test:live` to search for desks around New York City, fetch a returned listing, and look up the city coordinates. This is a read-only check and respects the server's rate limiter. It requires a valid session and available Marketplace listings. No automated test sends messages or creates listings.

## Rate Limiting

The server self-rate-limits to 3 requests/minute with random jitter to avoid detection. This means searches take a few seconds.

## Limitations

- Facebook login and Marketplace access must be verified with your own account; local tests use fixtures.
- The legacy automatic cookie extraction is macOS-only; Windows/Linux use `npm run login`.
- **Facebook ToS** — automating Facebook violates their Terms of Service
- **Fragile** — `doc_id` values change on Facebook deploys
- **Rate limited** — aggressive use may trigger CAPTCHAs or account flags
- **No write operations** — search/read only, no messaging or listing creation
- Monitors run when `check_monitors` is called and inspect one page of results; there is no background scheduler.
