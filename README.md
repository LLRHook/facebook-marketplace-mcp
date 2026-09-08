# Facebook Marketplace MCP Server

An MCP server for reading Facebook Marketplace through its internal GraphQL requests. This fork adds Windows and Linux login support, keeps the macOS login fallback, and reports Facebook failures explicitly. Searches expose structured results and uncertainty about location or price; an offline trip calculator compares a supplied deal value with driving and selling costs.

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
| `radius_km` | number | no | Radius; defaults to 50 if neither unit is supplied |
| `radius_miles` | number | no | Alternative radius in miles; cannot be combined with `radius_km` |
| `min_price` | number | no | Min price in dollars |
| `max_price` | number | no | Max price in dollars |
| `category` | string | no | Category ID |
| `limit` | integer | no | Requested page size, 1–100 (default: 24). Facebook may return a different count; the complete page is retained |
| `cursor` | string | no | `endCursor` from the previous result; keep the query and filters unchanged |
| `exclude_ids` | string array | no | Omit up to 2,000 previously seen listing IDs across queries or pages |
| `delivery` | string | no | `all` (default), `local_pickup`, or `shipping`; a request preference, not proof of pickup availability |
| `strict_radius` | boolean | no | Also exclude unknown coordinates (default: false). Known out-of-radius listings are always removed |
| `max_age_days` | integer | no | Filter this page by posted age; does not fetch the newest inventory globally |
| `include_unknown_dates` | boolean | no | Keep unknown dates when filtering by age (default: true) |
| `include_pending` | boolean | no | Include pending listings (default: false); sold listings are always removed |

The result includes readable text and `structuredContent`: query, retrieval timestamp, requested radius, effective Facebook radius, raw/retained counts, exclusion counts, listings, warnings and pagination. Miles are converted to kilometers; the Facebook request rounds up to whole kilometers because fractional values failed live replay. Distance checks retain the exact requested radius. Supplied listing coordinates are used for straight-line distance only. Current Facebook search responses often omit them, so many distances remain unknown; enabling `strict_radius` may remove an entire page.

The tool deduplicates retained IDs within a page and accepts `exclude_ids` to omit earlier results across queries/pages. Callers should retain their own query attribution. `limit` is a page-size request, not a hard result cap: truncating a larger Facebook page would skip listings when advancing its cursor. Changing location, phrase, delivery or upstream filters starts a new search. The local `exclude_ids` set can grow as pages are consumed.

An empty or repeated page does not always end Facebook's feed. Follow advancing cursors only for a bounded number of pages and track previously seen IDs/cursors. `paginationStatus` reports `more_results`, `end`, or `stalled`; stop on `stalled`. No tool automatically loops through all pages.

### `get_listing`
Get full details for a specific listing.

Structured output includes the listing and a `priceReview`. It flags headline prices of 0 or 1 and supported dollar amounts in the description that differ from the headline. Separate item prices, bundle totals and genuine conflicts can all trigger review; the tool never substitutes a guessed purchase price. Unsupported formats such as `$2k` remain unparsed. Detail coordinates are returned as unknown because live detail fragments repeated the viewer's map center across different seller cities. Card condition and sealed-product authenticity still require inspection.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `listing_id` | string | yes | Marketplace listing ID |

### `search_location`
Look up a city or town to obtain coordinates for `search_listings`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | City/town name, such as `New York NY` |

### `calculate_trip_deal`

An offline USD calculator for evaluating a specific lead after estimating its road trip. It needs no Facebook session and does not fetch routes or market prices.

Required inputs: `asking_price`, `estimated_value` (a supplied benchmark for the same items and condition), and `round_trip_miles` (road miles, not straight-line distance). Fuel defaults are `mpg: 28` and `fuel_price_per_gallon: 4`; override them for another vehicle or fuel price.

Optional inputs are `round_trip_hours`, `hourly_time_value`, `tolls`, `other_cash_costs`, `resale_fee_percent` and `other_selling_costs`, all defaulting to zero. An optional `all_in_vehicle_cost_per_mile` includes fuel and replaces the fuel calculation in the selected scenario. It must not be added to fuel again. All monetary inputs use USD.

The `structuredContent.trip_deal` result shows fuel, selected vehicle cost, optional time cost, purchase-plus-travel costs, benchmark headroom, proceeds after selling fees, resale headroom and the maximum purchase price for modeled resale break-even. These are calculations from supplied assumptions, not verified profit. The cash-fuel comparison excludes wear and time.

Example: `asking_price: 200`, `estimated_value: 381.73`, `round_trip_miles: 65.73` yields $9.39 fuel and $209.39 purchase-plus-fuel cost at the defaults. Add known tolls and inspection time before making a trip decision.

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
Check one page per monitor for IDs not previously seen. These may be older listings; this is separate from Facebook's native saved-search notifications. A monitor runs only when called and does not provide complete or real-time alerts.

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

For the deal-search changes, `node validation/deal-search-live.mjs` exercises the built MCP with the saved session: miles conversion, structured results, delivery request flags, cursor handling, known listing price warnings and the offline trip calculator. It saves public samples under ignored `.local/`. See [deal-search validation](docs/deal-search-validation.md) for observed empty pages, coordinate limits and test counts.

After logging in, run `npm run test:live` to search for desks around New York City, verify a returned listing's title, price and public URL against its details, and look up the city coordinates. This is a read-only check and respects the server's rate limiter. It requires a valid session and available Marketplace listings. No automated test sends messages or creates listings. The three live operations passed on Windows on September 8, 2026; see [validation evidence](docs/windows-validation.md) for scope and limitations.

## Rate Limiting

For finding deals, see the [research on Marketplace search methods](docs/marketplace-search-research.md) and [road-cost methodology](docs/driving-routes-research.md). Generic phrases, exact product searches and small typo experiments should be compared by the unique useful candidates they produce. Research suggestions such as native sorting, query attribution and price history are not all implemented in this server.

The server limits its Facebook requests to 3 per minute with small random delays. A call may wait for the next minute when earlier calls have used that allowance; allow at least 120 seconds for live tool calls.

## Limitations

- Facebook login and Marketplace access must be verified with your own account; local tests use fixtures.
- The legacy automatic cookie extraction is macOS-only; Windows/Linux use `npm run login`.
- **Facebook ToS** — automating Facebook violates their Terms of Service
- **Fragile** — `doc_id` values change on Facebook deploys
- **Rate limited** — aggressive use may trigger CAPTCHAs or account flags
- **No write operations** — search/read only, no messaging or listing creation
- Monitors run when `check_monitors` is called and inspect one page of results; there is no background scheduler.
