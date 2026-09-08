import test from "node:test";
import assert from "node:assert/strict";
import {
  createCalculateTripDealHandler,
  evaluateTripDeal,
} from "../src/tools/deal.js";

const woodbridge = { asking_price: 200, estimated_value: 381.73, round_trip_miles: 65.73 };

test("Woodbridge example uses explicit round-trip miles and default fuel assumptions", () => {
  const deal = evaluateTripDeal(woodbridge);
  assert.equal(deal.currency, "USD");
  assert.equal(deal.assumptions.mpg, 28);
  assert.equal(deal.assumptions.fuel_price_per_gallon, 4);
  assert.equal(deal.vehicle_cost_basis, "fuel");
  assert.equal(deal.fuel_cost, 9.39);
  assert.equal(deal.vehicle_cost_used, 9.39);
  assert.equal(deal.time_cost, 0);
  assert.equal(deal.cash_fuel_acquisition_cost, 209.39);
  assert.equal(deal.selected_scenario_acquisition_cost, 209.39);
  assert.equal(deal.benchmark_headroom, 172.34);
  assert.equal(deal.net_resale_proceeds, 381.73);
  assert.equal(deal.resale_headroom, 172.34);
  assert.equal(deal.max_purchase_price_break_even, 372.34);
});

test("fees and user-valued time can erase resale headroom despite a higher benchmark", () => {
  const deal = evaluateTripDeal({
    ...woodbridge, round_trip_hours: 4, hourly_time_value: 30,
    tolls: 15, other_cash_costs: 10, resale_fee_percent: 25, other_selling_costs: 25,
  });
  assert.equal(deal.time_cost, 120);
  assert.equal(deal.cash_fuel_acquisition_cost, 234.39);
  assert.equal(deal.selected_scenario_acquisition_cost, 354.39);
  assert.equal(deal.cash_fuel_benchmark_headroom, 147.34);
  assert.equal(deal.benchmark_headroom, 27.34);
  assert.equal(deal.resale_fee_cost, 95.43);
  assert.equal(deal.net_resale_proceeds, 261.30);
  assert.equal(deal.cash_fuel_resale_headroom, 26.91);
  assert.equal(deal.resale_headroom, -93.09);
  assert.equal(deal.max_purchase_price_break_even, 106.91);
});

test("zero miles incur no fuel or mileage cost", () => {
  const deal = evaluateTripDeal({ ...woodbridge, round_trip_miles: 0, all_in_vehicle_cost_per_mile: 0.7 });
  assert.equal(deal.fuel_cost, 0);
  assert.equal(deal.vehicle_cost_used, 0);
  assert.equal(deal.selected_scenario_acquisition_cost, 200);
  assert.equal(deal.resale_headroom, 181.73);
});

test("all-in mileage cost replaces fuel and preserves the cash-fuel comparison", () => {
  const deal = evaluateTripDeal({ ...woodbridge, all_in_vehicle_cost_per_mile: 0.7 });
  assert.equal(deal.vehicle_cost_basis, "all_in_per_mile");
  assert.equal(deal.fuel_cost, 9.39);
  assert.equal(deal.vehicle_cost_used, 46.01);
  assert.equal(deal.cash_fuel_acquisition_cost, 209.39);
  assert.equal(deal.selected_scenario_acquisition_cost, 246.01);
  assert.equal(deal.benchmark_headroom, 135.72);
  assert.equal(deal.max_purchase_price_break_even, 335.72);
  assert.equal(evaluateTripDeal({ ...woodbridge, all_in_vehicle_cost_per_mile: 0 }).selected_scenario_acquisition_cost, 200);
});

test("calculations retain sub-cent amounts until each final output is rounded", () => {
  const deal = evaluateTripDeal({
    asking_price: 0, estimated_value: 1, round_trip_miles: 0.004,
    mpg: 1, fuel_price_per_gallon: 1, tolls: 0.004,
    resale_fee_percent: 0.4, other_selling_costs: 0.004,
  });
  assert.equal(deal.fuel_cost, 0);
  assert.equal(deal.cash_fuel_acquisition_cost, 0.01);
  assert.equal(deal.resale_fee_cost, 0);
  assert.equal(deal.net_resale_proceeds, 0.99);
  assert.equal(deal.resale_headroom, 0.98);
  assert.equal(deal.max_purchase_price_break_even, 0.98);
});

test("negative proceeds and break-even purchase prices remain visible", () => {
  const deal = evaluateTripDeal({ asking_price: 0, estimated_value: 0, round_trip_miles: 0, tolls: 5, other_selling_costs: 2 });
  assert.equal(deal.net_resale_proceeds, -2);
  assert.equal(deal.resale_headroom, -7);
  assert.equal(deal.max_purchase_price_break_even, -7);
});

test("all numeric inputs reject negative, non-finite and non-numeric values", () => {
  for (const field of [
    "asking_price", "estimated_value", "round_trip_miles", "mpg", "fuel_price_per_gallon",
    "round_trip_hours", "hourly_time_value", "tolls", "other_cash_costs",
    "resale_fee_percent", "other_selling_costs", "all_in_vehicle_cost_per_mile",
  ]) {
    for (const value of [-1, NaN, Infinity, -Infinity, "4", null]) {
      assert.throws(() => evaluateTripDeal({ ...woodbridge, [field]: value }), `${field} accepted ${String(value)}`);
    }
  }
  for (const invalid of [
    {}, { ...woodbridge, mpg: 0 }, { ...woodbridge, resale_fee_percent: 100 },
    { ...woodbridge, resale_fee_percent: 101 }, { ...woodbridge, currency: "CAD" },
    { ...woodbridge, round_trip_miles: undefined }, { ...woodbridge, asking_price: undefined },
    { ...woodbridge, estimated_value: undefined },
  ]) assert.throws(() => evaluateTripDeal(invalid));
});

test("arithmetic overflow returns an error instead of non-finite structured values", async () => {
  const response = await createCalculateTripDealHandler()({ ...woodbridge, round_trip_miles: Number.MAX_VALUE, mpg: Number.MIN_VALUE });
  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /cent-precision range/);
  assert.equal(response.structuredContent, undefined);
});

test("handler provides a named structured result, readable assumptions and validation errors", async () => {
  const handler = createCalculateTripDealHandler();
  const response = await handler(woodbridge);
  assert.equal(response.structuredContent?.trip_deal.fuel_cost, 9.39);
  assert.match(response.content[0].text, /65\.73 round-trip road miles/);
  assert.match(response.content[0].text, /USD 209\.39/);
  assert.match(response.content[0].text, /user-provided, condition-matched benchmark/);
  assert.match(response.content[0].text, /excludes vehicle wear and time value/);
  const invalid = await handler({ ...woodbridge, mpg: 0 });
  assert.equal(invalid.isError, true);
  assert.equal(invalid.structuredContent, undefined);
});
