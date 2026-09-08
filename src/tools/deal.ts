import { z } from "zod";

const nonnegative = () => z.number().finite().nonnegative();

export const calculateTripDealSchema = {
  asking_price: nonnegative().describe("Purchase price in USD"),
  estimated_value: nonnegative().describe(
    "User-provided USD benchmark for the same items and condition; no automatic valuation"
  ),
  round_trip_miles: nonnegative().describe(
    "Explicit round-trip road miles from the user or a route estimate; never straight-line distance"
  ),
  mpg: z.number().finite().positive().default(28).describe("Assumed miles per US gallon (default: 28)"),
  fuel_price_per_gallon: nonnegative().default(4).describe("Assumed USD per US gallon (default: 4)"),
  round_trip_hours: nonnegative().default(0).describe("User-assumed total travel hours (default: 0)"),
  hourly_time_value: nonnegative().default(0).describe("User-assumed USD value per travel hour (default: 0)"),
  tolls: nonnegative().default(0).describe("Total round-trip tolls in USD"),
  other_cash_costs: nonnegative().default(0).describe("Other acquisition cash costs in USD, excluding costs already entered"),
  resale_fee_percent: nonnegative().lt(100).default(0).describe("Resale fee percentage applied to estimated_value, below 100"),
  other_selling_costs: nonnegative().default(0).describe("Other selling costs in USD, such as shipping and supplies"),
  all_in_vehicle_cost_per_mile: nonnegative().optional().describe(
    "Optional user-assumed USD vehicle cost per mile, including fuel; replaces fuel in the selected scenario. No IRS rate is assumed."
  ),
  currency: z.literal("USD").default("USD").describe("All monetary inputs must use USD; no currency conversion"),
};

const inputSchema = z.object(calculateTripDealSchema).strict();
export type TripDealInput = z.input<typeof inputSchema>;

function roundCents(value: number): number {
  const scaled = Math.abs(value) * 100;
  const cents = Math.round(scaled + Number.EPSILON * scaled);
  if (!Number.isSafeInteger(cents)) {
    throw new Error("Calculated amount exceeds the supported finite, cent-precision range.");
  }
  return cents === 0 ? 0 : Math.sign(value) * cents / 100;
}

export function evaluateTripDeal(input: unknown) {
  const args = inputSchema.parse(input);
  const fuelCost = args.round_trip_miles / args.mpg * args.fuel_price_per_gallon;
  const allInRate = args.all_in_vehicle_cost_per_mile;
  const vehicleCost = allInRate === undefined ? fuelCost : args.round_trip_miles * allInRate;
  const timeCost = args.round_trip_hours * args.hourly_time_value;
  const otherAcquisitionCosts = args.tolls + args.other_cash_costs;
  const cashFuelAcquisition = args.asking_price + fuelCost + otherAcquisitionCosts;
  const selectedNonpurchaseCosts = vehicleCost + timeCost + otherAcquisitionCosts;
  const selectedAcquisition = args.asking_price + selectedNonpurchaseCosts;
  const resaleFee = args.estimated_value * (args.resale_fee_percent / 100);
  const netResaleProceeds = args.estimated_value - resaleFee - args.other_selling_costs;

  return {
    currency: args.currency,
    assumptions: args,
    vehicle_cost_basis: allInRate === undefined ? "fuel" as const : "all_in_per_mile" as const,
    fuel_cost: roundCents(fuelCost),
    vehicle_cost_used: roundCents(vehicleCost),
    time_cost: roundCents(timeCost),
    cash_fuel_acquisition_cost: roundCents(cashFuelAcquisition),
    selected_scenario_acquisition_cost: roundCents(selectedAcquisition),
    cash_fuel_benchmark_headroom: roundCents(args.estimated_value - cashFuelAcquisition),
    benchmark_headroom: roundCents(args.estimated_value - selectedAcquisition),
    resale_fee_cost: roundCents(resaleFee),
    net_resale_proceeds: roundCents(netResaleProceeds),
    cash_fuel_resale_headroom: roundCents(netResaleProceeds - cashFuelAcquisition),
    resale_headroom: roundCents(netResaleProceeds - selectedAcquisition),
    max_purchase_price_break_even: roundCents(netResaleProceeds - selectedNonpurchaseCosts),
    caveats: [
      "The estimated value is a user-provided, condition-matched benchmark. Headroom is a scenario estimate, not verified profit or a guaranteed sale price.",
      "Cash-fuel acquisition includes purchase price, fuel, tolls and other acquisition cash costs; it excludes vehicle wear and time value.",
      "The selected scenario includes the user's time assumptions. An explicit all-in vehicle rate replaces fuel; no IRS rate is assumed.",
      "Road miles and travel hours are supplied assumptions; this tool does not calculate a route or convert straight-line distance.",
      "Resale fees apply to the estimated value. Include any applicable taxes or other costs in the relevant cash or selling inputs without double counting.",
      "A negative break-even purchase price means the modeled costs exceed net resale proceeds even at a zero purchase price.",
    ],
  };
}

export function createCalculateTripDealHandler() {
  return async (args: TripDealInput) => {
    try {
      const deal = evaluateTripDeal(args);
      const money = (value: number) => `USD ${value.toFixed(2)}`;
      const vehicleBasis = deal.assumptions.all_in_vehicle_cost_per_mile === undefined
        ? "fuel"
        : `user-assumed all-in rate of ${money(deal.assumptions.all_in_vehicle_cost_per_mile)}/mile`;
      const text = [
        `Trip deal using a supplied benchmark of ${money(deal.assumptions.estimated_value)} and asking price of ${money(deal.assumptions.asking_price)}.`,
        `Travel assumptions: ${deal.assumptions.round_trip_miles} round-trip road miles, ${deal.assumptions.mpg} mpg, ${money(deal.assumptions.fuel_price_per_gallon)}/gallon; ${deal.assumptions.round_trip_hours} hours at ${money(deal.assumptions.hourly_time_value)}/hour.`,
        `Fuel: ${money(deal.fuel_cost)}. Vehicle cost used: ${money(deal.vehicle_cost_used)} (${vehicleBasis}). Time value: ${money(deal.time_cost)}.`,
        `Other costs: ${money(deal.assumptions.tolls)} tolls, ${money(deal.assumptions.other_cash_costs)} acquisition cash costs, ${money(deal.assumptions.other_selling_costs)} selling costs. Resale fee assumption: ${deal.assumptions.resale_fee_percent}%.`,
        `Cash-fuel acquisition: ${money(deal.cash_fuel_acquisition_cost)}; benchmark headroom: ${money(deal.cash_fuel_benchmark_headroom)}.`,
        `Selected scenario acquisition: ${money(deal.selected_scenario_acquisition_cost)}; benchmark headroom: ${money(deal.benchmark_headroom)}.`,
        `Resale fee: ${money(deal.resale_fee_cost)}. Net resale proceeds after selling costs: ${money(deal.net_resale_proceeds)}.`,
        `Resale headroom: ${money(deal.resale_headroom)} in the selected scenario; ${money(deal.cash_fuel_resale_headroom)} with cash fuel costs.`,
        `Maximum purchase price to break even on resale in the selected scenario: ${money(deal.max_purchase_price_break_even)}.`,
        "",
        ...deal.caveats,
      ].join("\n");
      return { content: [{ type: "text" as const, text }], structuredContent: { trip_deal: deal } };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error calculating trip deal: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  };
}
