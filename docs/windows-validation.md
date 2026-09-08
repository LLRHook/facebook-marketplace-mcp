# Windows validation

Tested on September 8, 2026 with Windows and Node 24.15.0. Upstream baseline: `30fd6d1`.

The upstream repository installed and compiled. Its MCP server exposed seven tools, and isolated monitor persistence worked. All three Facebook read tools failed at the hard-coded macOS Chrome cookie path. Synthetic HTTP-200 error responses were also reported as empty successes; a login page was accepted as a listing, and `maxPrice: 0` was replaced with the default ceiling.

The Windows implementation passed these local checks:

| Check | Result |
| --- | --- |
| `npm ci --omit=optional --no-audit --no-fund` | Clean install without native SQLite |
| `npm test` | Build, 36 source tests, 5 response regressions, 9 MCP subprocess checks passed |
| `npm run test:browser` | Real Windows browser launched; profile with spaces persisted fixture cookies across restart; saved session loaded |
| Capture script TypeScript check | Passed with strict checking and no emit |
| `git diff --check` | Passed |
| Independent review | Login navigation race reproduced and fixed; no remaining blocking findings |

The MCP checks cover discovery of all seven tools, monitor creation, duplicate rejection, persistence across server restart, deletion, an empty monitor check, and actionable missing-session errors for all three Facebook read tools. They use temporary home directories and do not read the user's monitor file or browser cookies.

The browser check uses fixture cookies in a separate temporary profile and a local data URL. It makes no Facebook requests. The login CLI also opened the real dedicated Chrome profile for interactive authentication.

Authenticated live validation passed on September 8, 2026 after `npm run login` saved a Windows browser session. `npm run test:live` exercised the actual MCP server and confirmed:

- A desk search around New York City returned listing links.
- A returned listing's detail title, price, and public URL matched its search result, with images or description present.
- A location lookup returned coordinates near New York City.

The first live listing-detail request exposed separate public product IDs and internal listing IDs. The parser now follows the explicit `product_item.id` relationship and combines only associated fragments. A replay of the originally failing page recovered the matching title and price, four photos, a description, seller, and condition. Two synthetic regression tests cover this mapping without storing real account or listing data in the test suite.

The login browser closes automatically after saving the session; this is successful completion, not a crash. The live test writes a local, ignored `validation/live-results.json` containing check outcomes and counts. These checks establish the three core read operations with one account at that time; they do not verify every filter or Marketplace category. Query IDs and shapes come from the August 28 community capture in [upstream PR #3](https://github.com/jdcodes1/facebook-marketplace-mcp/pull/3); they may require recapture if Facebook changes its protocol. The public/internal listing-ID mapping is also covered by [upstream PR #4](https://github.com/jdcodes1/facebook-marketplace-mcp/pull/4).

The GitHub Actions workflow runs the offline build and tests on Windows, macOS and Linux with Node 22 and 24. It omits the optional SQLite dependency. The legacy macOS Keychain fallback still requires that dependency and has not been exercised locally on this Windows machine.

The first cloud run found a macOS CLI failure through a symlinked temporary directory. A Windows directory-junction test reproduced the same silent exit. Entry point detection now resolves the real file path as well as its URL encoding; the regression runs on every CI platform.
