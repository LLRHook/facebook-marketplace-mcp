# Deal search validation — September 8, 2026

The changes address failures encountered while searching for Pokémon listings around Sterling: fractional radii rejected by Facebook, irrelevant distant results, misleading headline prices, repeated result rows, unavailable cursors in the MCP interface, and no way to compare a discount with pickup costs.

## Implemented behavior

- `search_listings` accepts either miles or kilometers. The Facebook request rounds up to whole kilometers; client distance checks use the requested radius. Invalid units, ranges and overflowing amounts fail explicitly.
- Structured search output preserves the full server page, prices, observed posting dates, optional coordinates/delivery types, exclusion counts and pagination. The requested count is documented as a page-size hint. Eligible listing IDs are deduplicated within a page; `exclude_ids` also omits earlier results across pages or queries. Repeated cursors are flagged as stalled.
- Known out-of-radius, sold and (by default) pending listings are removed. Unknown coordinates stay unknown; optional strict radius removes them too. Age filtering operates on the fetched page and is not a global newest-first search.
- Delivery preferences change the existing Facebook request flags, with a warning that receipt of results does not establish pickup availability.
- `get_listing` exposes full details and price-review cues without replacing the headline price. Unsupported price shorthand remains unparsed. Detail coordinates remain null because live fragments repeated the viewer's map center across different seller cities.
- `calculate_trip_deal` uses explicit road miles and supplied benchmark values. It separates fuel, optional time, vehicle-rate alternatives, fees and other costs. An all-in vehicle rate replaces fuel and cannot silently double-count it.
- Monitor output distinguishes an ID newly seen by a monitor from a newly posted listing. Existing monitors still check one page when called.

## Automated and independent checks

`npm test` passed 59 source tests, 5 response-handling tests and 11 MCP subprocess checks on Windows. The subprocess retained the seven existing tool names and discovered the new calculator, exercised its structured output without Facebook authentication, rejected conflicting radius units, and checked the existing monitor persistence and authentication errors.

Independent validation passed 30 focused parser/search/calculator tests and separately called the built MCP calculator and a fixture-backed listing handler. Review found and resolved three edge cases: an ineligible duplicate hiding an eligible row, `$2k` being read as `$2`, and converted finite inputs overflowing. Regression checks cover each case. No new dependency was added.

## Live evidence and limits

A controlled live comparison of the same `pokemon binder` search returned GraphQL errors with 402.336 km and 13 usable listings with 403 km. After rounding at the request boundary, `radius_miles: 250` returned 13 structured listings and reported the two radii separately. All 13 omitted coordinates; no claim of strict geographic verification is made for them.

Facebook accepted a `local_pickup` request with shipping disabled. Returned listings included delivery types such as `IN_PERSON`, `DOOR_PICKUP`, `PUBLIC_MEETUP` and `SHIPPING_ONSITE`; delivery-filter enforcement is not established by that response alone.

Browser capture confirmed the same document ID and top-level cursor mapping. A bounded Sterling replay returned 13 listings, two empty pages with advancing cursors, then a terminal page containing `MarketplaceSearchFeedEndOfResults`, related searches and an ad. That exact terminal marker is now accepted only when `has_next_page` is false; unknown non-listing responses still fail explicitly. No additional listing IDs were discovered in that continuation sample. Cursor transport and termination are supported; increased inventory coverage is not claimed.

The final live MCP harness passed six checks: a 250-mile structured search, accepted local-pickup request flags, continuation with prior IDs excluded, the trip calculator, and two full listing details with price-review warnings. The continuation produced zero new retained IDs and recorded that limit explicitly. Live details also exposed a separate coordinate problem: McLean, Washington, Fredericksburg and Burtonsville listings all returned the viewer's map center. A regression now prevents detail fragments from presenting those values as seller pickup coordinates; routed comparisons use independently resolved towns.

The repeatable read-only live harness is `node validation/deal-search-live.mjs` after `npm run build`. Its public-listing samples and check results are stored under ignored `.local/deal-search-live.json`. Saved sessions, browser profiles and raw captures remain ignored. No test sends seller messages, posts listings or purchases items.

The road-cost research uses public OSRM routes and town-center geocodes; the calculator itself does not route or value cards. See [route methods](driving-routes-research.md) and [Marketplace research](marketplace-search-research.md).
