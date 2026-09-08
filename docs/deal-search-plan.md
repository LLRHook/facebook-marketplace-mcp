# Deal search improvements — September 8, 2026

The goal is to compare Pokémon leads from Sterling using the user's 28 MPG and $4/gallon, research useful Marketplace search methods, and improve this MCP using failures observed in those searches.

## Execution plan

Prerequisites: the working Windows login, existing authenticated search/detail client, current listing snapshots, and public road routing. No new package is needed. The balanced implementation workflow uses one code helper for an isolated arithmetic module; independent research handles routes and Marketplace documentation.

1. Route the strongest leads by road and calculate fuel, with time and wear as separate, explicit scenarios. Verify contents, condition and price ambiguity before calling a lead worthwhile.
2. Document current Meta guidance and firsthand buyer experiments, separating platform facts from anecdotes.
3. Add explicit search pagination and structured results, coordinate-based distance checks where Facebook supplies coordinates, local-pickup preference, and warnings for low headline prices and description prices. Preserve unknown data as unknown.
4. Add an offline trip/deal calculator using supplied road mileage and benchmark values. Avoid assuming that straight-line distance is driving distance or that market value equals sale proceeds.
5. Run regression and MCP subprocess checks, exercise the changed search/detail paths live, and obtain independent review. Record limits and usage in the README.

Risks: Facebook's private request format and response fields can change; optional filters may be ignored. Price warnings are cues for human review, not automatic repricing or authentication. Route estimates use town centers and exclude live traffic and unpriced tolls. Keep saved sessions and raw captures ignored. Rollback is reverting the changed source files and rebuilding; existing saved sessions and monitors do not need migration.

Expected outcome: a sourced shortlist with explicit costs, repeatable search tactics, and tested MCP tools that expose uncertainty and support evaluating whether pickup is worth the trip.
