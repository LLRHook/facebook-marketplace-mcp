# Driving costs for Pokémon pickup trips

Checked September 8, 2026, at approximately 08:43 EDT; Burke was added at 08:58 EDT. Starting point: Sterling, Virginia, latitude 39.0062, longitude -77.4286, supplied by the task. Pickup addresses are unknown, so each destination uses the town or city center returned by [Nominatim](https://nominatim.org/release-docs/latest/api/Search/). Boothwyn is the representative point for Upper Chichester.

The user's 2009 Honda Accord assumptions are 28 miles per US gallon and $4 per gallon. Fuel therefore costs $4 / 28 = **$0.142857 per mile**. Time has no assigned value in the main calculation. The $20/hour column is an optional comparison supplied by the research task, not the user's stated wage or preference.

## Road routes and calculated costs

Each query routes Sterling to the destination and back to Sterling, with two separate legs. Distances are road distances returned by OSRM, not straight-line distances or an arbitrary distance multiplier. OSRM documents distance in meters and estimated duration in seconds. Its route service selects a route using the configured driving profile. [OSRM API documentation](https://project-osrm.org/docs/v5.24.0/api/)

| Pickup location | Road miles, round trip | Estimated driving, round trip | Fuel only | Fuel plus optional $20/hour driving time | Route response |
|---|---:|---:|---:|---:|---|
| Reston, VA | 17.1 | 0h 29m | $2.45 | $12.26 | [OSRM](https://router.project-osrm.org/route/v1/driving/-77.4286,39.0062;-77.3464516,38.9532820;-77.4286,39.0062?overview=false&steps=true&continue_straight=false) |
| Leesburg, VA | 23.9 | 0h 41m | $3.41 | $17.11 | [OSRM](https://router.project-osrm.org/route/v1/driving/-77.4286,39.0062;-77.5645607,39.1154506;-77.4286,39.0062?overview=false&steps=true&continue_straight=false) |
| Burke, VA | 47.2 | 1h 18m | $6.74 | $32.89 | [OSRM](https://router.project-osrm.org/route/v1/driving/-77.4286,39.0062;-77.2688875,38.7812445;-77.4286,39.0062?overview=false&steps=true&continue_straight=false) |
| Woodbridge, VA | 65.7 | 1h 50m | $9.39 | $46.02 | [OSRM](https://router.project-osrm.org/route/v1/driving/-77.4286,39.0062;-77.2676335,38.6364470;-77.4286,39.0062?overview=false&steps=true&continue_straight=false) |
| Fredericksburg, VA | 120.0 | 2h 59m | $17.15 | $76.68 | [OSRM](https://router.project-osrm.org/route/v1/driving/-77.4286,39.0062;-77.4571472,38.3001159;-77.4286,39.0062?overview=false&steps=true&continue_straight=false) |
| Midlothian, VA | 252.9 | 5h 32m | $36.13 | $146.77 | [OSRM](https://router.project-osrm.org/route/v1/driving/-77.4286,39.0062;-77.6473195,37.4868060;-77.4286,39.0062?overview=false&steps=true&continue_straight=false) |
| Boothwyn, PA | 286.1 | 5h 58m | $40.87 | $160.05 | [OSRM](https://router.project-osrm.org/route/v1/driving/-77.4286,39.0062;-75.4488451,39.8359070;-77.4286,39.0062?overview=false&steps=true&continue_straight=false) |
| Philadelphia, PA | 322.1 | 6h 55m | $46.01 | $184.34 | [OSRM](https://router.project-osrm.org/route/v1/driving/-77.4286,39.0062;-75.1635262,39.9527237;-77.4286,39.0062?overview=false&steps=true&continue_straight=false) |
| Baden, PA | 515.9 | 10h 22m | $73.70 | $281.04 | [OSRM](https://router.project-osrm.org/route/v1/driving/-77.4286,39.0062;-80.2281159,40.6350668;-77.4286,39.0062?overview=false&steps=true&continue_straight=false) |

Use these as preliminary trip estimates. The model has no selected departure time, verified live traffic, seller wait, card inspection time, rest stops or parking costs. The listed town center can be miles from the actual pickup. The start and end coordinates were snapped to nearby roads by approximately 2–77 meters.

Tolls are **unpriced and not excluded**. The default Reston route uses Dulles Toll Road. Boothwyn and Philadelphia routes include Dulles Toll Road and toll facilities along the I-95 corridor; Baden includes Pennsylvania Turnpike. A different toll preference can change both distance and time. Do not call the fuel column the complete trip cost.

Raw geocoding results, outbound/return legs, route steps, timestamps and calculation inputs are in `.local/driving-routes.json`. Responses were cached after one pass with requests more than one second apart, following the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) and [OSRM demo server guidance](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server). The demo service gives no guarantee of map-data update timing. Map and geocoding data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL; routing: OSRM.

## Vehicle wear and broader cost scenarios

AAA's 2025 study reports **11.04 cents/mile for maintenance, repair and tires**. It models new vehicles over five years and 75,000 miles, including maintenance parts/labor, an extended warranty, wear repairs and replacement tires. It is a reference scenario, not a measurement of a 2009 Accord's next trip. The Accord's service history, tires, current mileage and depreciation are unknown. [AAA 2025 driving-cost fact sheet](https://newsroom.aaa.com/wp-content/uploads/2025/09/UPDATE-AAA-Fact-Sheet-Your-Driving-Cost-9.2025-1.pdf)

For an optional wear allowance based on that benchmark, add `round-trip miles × $0.1104` to the calculated fuel. This excludes depreciation, insurance and finance costs.

The IRS business mileage benchmark is **76 cents/mile for July 1–December 31, 2026**, replacing 72.5 cents for the first half of the year. It is a broad vehicle-cost proxy, not an estimate of this Accord's incremental expense or a statement that the shopping trip qualifies for a deduction. [IRS current rates](https://www.irs.gov/tax-professionals/standard-mileage-rates), [Announcement 2026-11](https://www.irs.gov/irb/2026-29_irb)

The IRS methodology includes fixed and variable vehicle costs. Its rate already includes fuel and vehicle wear, so use it **instead of** the fuel-plus-wear calculation; adding both would count those expenses twice. Time, parking and unpriced tolls remain separate. [IRS methodology, Notice 2026-10](https://www.irs.gov/irb/2026-04_IRB)

| Pickup location | Fuel plus AAA maintenance/repair/tire scenario | IRS broad vehicle-cost proxy, excluding time |
|---|---:|---:|
| Reston | $4.34 | $13.02 |
| Leesburg | $6.05 | $18.16 |
| Burke | $11.96 | $35.88 |
| Woodbridge | $16.65 | $49.95 |
| Fredericksburg | $30.40 | $91.23 |
| Midlothian | $64.04 | $192.19 |
| Boothwyn | $72.45 | $217.42 |
| Philadelphia | $81.57 | $244.77 |
| Baden | $130.65 | $392.08 |

## Applying this to the deals

Use `verified conservative card/product value − purchase price − trip costs` for a personal-purchase comparison. For resale, use realistic sale proceeds after selling fees and shipping instead of retail market value. Keep uncertain card condition, conflicting asking prices and unresolved product variants visible in the comparison.

A route does not establish that a lot is a deal. At the optional $20/hour time value, Boothwyn needs more than $160 of pre-travel advantage, Philadelphia more than $184 and Baden more than $281 just to cover gas and modeled driving time; tolls and wear would raise those amounts. Reston and Leesburg have much smaller travel costs, so a modest verified discount can survive the trip.

For the [Burke 151 Blooming Waters listing](https://www.facebook.com/marketplace/item/37604465692530310/), the task supplies a $275 asking price and $326.30 benchmark. Using those inputs, purchase plus fuel is $281.74, leaving $44.56 below the benchmark. Including the optional $20/hour driving-time value raises acquisition cost to $307.89 and leaves $18.41. The fuel-plus-AAA-maintenance scenario is $286.96 before time, leaving $39.34. These figures do not establish sale proceeds or authenticate the product; fees, shipping, inspection time and any unpriced tolls would reduce the headroom. The returned Burke route uses Sully Road and Fairfax County Parkway, with no toll or express road name identified in its returned steps.
