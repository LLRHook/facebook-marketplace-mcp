import { z } from "zod";
import type { FacebookClient } from "../facebook/client.js";
import { analyzePrice, distanceKm } from "../facebook/listing-analysis.js";

export const searchListingsSchema = {
  query: z.string().trim().min(1).max(200).describe("One search phrase; run generic, exact-product and collection phrases separately"),
  latitude: z.number().finite().min(-90).max(90).describe("Latitude of search center"),
  longitude: z.number().finite().min(-180).max(180).describe("Longitude of search center"),
  radius_km: z.number().finite().positive().max(Number.MAX_SAFE_INTEGER).optional().describe("Radius in km; defaults to 50 if neither radius unit is supplied"),
  radius_miles: z.number().finite().positive().max(Number.MAX_SAFE_INTEGER / 1.609344).optional().describe("Radius in miles; do not also supply radius_km"),
  min_price: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER / 100).optional().describe("Minimum headline price in dollars; can hide placeholder-priced lots"),
  max_price: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER / 100).optional().describe("Maximum headline price in dollars"),
  category: z.string().optional().describe("Category ID"),
  limit: z.number().int().min(1).max(100).default(24).describe("Requested page size. Facebook may return a different number; the full page is retained to avoid skipping items"),
  cursor: z.string().min(1).max(20000).optional().describe("endCursor from a prior page; keep the query, location and filters unchanged"),
  exclude_ids: z.array(z.string().min(1).max(100)).max(2000).default([]).describe("Previously seen listing IDs to omit across queries or pages (up to 2000); this is a local filter"),
  delivery: z.enum(["all", "local_pickup", "shipping"]).default("all").describe("Requested Facebook delivery filter; pickup availability still needs confirmation"),
  strict_radius: z.boolean().default(false).describe("Exclude listings with unknown coordinates as well as known out-of-radius listings. Facebook often omits coordinates"),
  max_age_days: z.number().int().positive().max(3650).optional().describe("Filter this returned page by known posted dates; does not change Facebook's ranking or fetch older pages"),
  include_unknown_dates: z.boolean().default(true).describe("Keep unknown posted dates when max_age_days is set"),
  include_pending: z.boolean().default(false).describe("Include listings marked pending; sold listings are always excluded"),
};

const inputSchema = z.object(searchListingsSchema).superRefine((args, context) => {
  if (args.radius_km !== undefined && args.radius_miles !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Supply radius_km or radius_miles, not both." });
  }
  if (args.min_price !== undefined && args.max_price !== undefined && args.min_price > args.max_price) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "min_price cannot exceed max_price." });
  }
});

export function createSearchHandler(client: Pick<FacebookClient, "searchListings">) {
  return async (input: z.input<typeof inputSchema>) => {
    try {
      const args = inputSchema.parse(input);
      const radiusKm = args.radius_miles !== undefined ? args.radius_miles * 1.609344 : args.radius_km ?? 50;
      const facebookRadiusKm = Math.ceil(radiusKm);
      const result = await client.searchListings({
        query: args.query, latitude: args.latitude, longitude: args.longitude,
        radiusKm, minPrice: args.min_price, maxPrice: args.max_price,
        category: args.category, limit: args.limit, cursor: args.cursor, delivery: args.delivery,
      });
      const seen = new Set<string>(args.exclude_ids);
      const excluded = { duplicate: 0, unavailable: 0, outsideRadius: 0, unknownDistance: 0, age: 0 };
      const checkedAt = new Date();
      const listings = result.listings.flatMap(listing => {
        if (seen.has(listing.id)) { excluded.duplicate++; return []; }
        if (listing.isSold || (!args.include_pending && listing.isPending)) { excluded.unavailable++; return []; }
        const hasCoordinates = typeof listing.latitude === "number" && Number.isFinite(listing.latitude) && Math.abs(listing.latitude) <= 90 &&
          typeof listing.longitude === "number" && Number.isFinite(listing.longitude) && Math.abs(listing.longitude) <= 180;
        const distance = hasCoordinates ? distanceKm(args.latitude, args.longitude, listing.latitude!, listing.longitude!) : null;
        if (distance !== null && distance > radiusKm) { excluded.outsideRadius++; return []; }
        if (distance === null && args.strict_radius) { excluded.unknownDistance++; return []; }
        const timestamp = Date.parse(listing.postedDate);
        const ageDays = Number.isFinite(timestamp) && timestamp <= checkedAt.getTime()
          ? (checkedAt.getTime() - timestamp) / 86400000 : null;
        if (args.max_age_days !== undefined && (ageDays !== null
          ? ageDays > args.max_age_days : !args.include_unknown_dates)) { excluded.age++; return []; }
        seen.add(listing.id);
        return [{ ...listing, straightLineDistanceKm: distance === null ? null : Math.round(distance * 100) / 100,
          distanceStatus: distance === null ? "unknown" : "within_radius", ageDays,
          priceReview: analyzePrice(listing) }];
      });
      const warnings = ["This is one Facebook result page. Page filters and deduplication do not scan every listing in the area."];
      if (facebookRadiusKm !== radiusKm) warnings.push(`Facebook receives a whole-kilometer radius of ${facebookRadiusKm} km; coordinate checks use your requested ${radiusKm} km.`);
      if (listings.some(listing => listing.distanceStatus === "unknown")) warnings.push("Some distances are unknown because Facebook omitted coordinates. These results are not confirmed within the radius.");
      if (args.strict_radius && excluded.unknownDistance) warnings.push("Strict radius removed listings with unknown coordinates; zero matches does not establish that no nearby listings exist.");
      if (result.listings.length !== args.limit) warnings.push(`Facebook returned ${result.listings.length} rows for a requested page size of ${args.limit}; all rows were processed.`);
      if (args.delivery !== "all") warnings.push("The delivery preference was sent to Facebook. Confirm the listing's pickup or shipping options before planning a trip.");
      if (result.hasNextPage && !result.endCursor) warnings.push("Facebook reports more results but did not supply a usable continuation cursor.");
      const paginationStatus = !result.hasNextPage ? "end" : !result.endCursor || result.endCursor === args.cursor ? "stalled" : "more_results";
      if (paginationStatus === "stalled") warnings.push("Pagination cannot advance with this response. Stop rather than repeating the same cursor.");
      if (result.hasNextPage && listings.length === 0 && paginationStatus === "more_results") warnings.push("This page has no retained listings but its cursor advanced. A bounded continuation may reveal more; stop if pages or cursors repeat.");
      const data = { query: args.query, checkedAt: checkedAt.toISOString(), radiusKm, facebookRadiusKm,
        receivedCount: result.listings.length, returnedCount: listings.length, excluded,
        hasNextPage: result.hasNextPage, endCursor: result.endCursor, paginationStatus, listings, warnings };
      const summary = listings.map((listing, index) =>
        `${index + 1}. **${listing.title}** — ${listing.price}\n   📍 ${listing.location} | 👤 ${listing.sellerName}${listing.isPending ? " ⏳ PENDING" : ""}\n   Distance: ${listing.straightLineDistanceKm === null ? "unknown" : `${listing.straightLineDistanceKm} km straight-line (not driving distance)`}\n   Posted: ${listing.postedDate || "unknown"}\n   🔗 ${listing.url}${listing.priceReview.warnings.map(warning => `\n   Price review: ${warning}`).join("")}`
      ).join("\n\n");
      const continuation = result.endCursor && paginationStatus === "more_results" ? `\n\nNext page cursor (reuse the same query and filters): ${result.endCursor}` : "";
      return { structuredContent: data, content: [{ type: "text" as const,
        text: `Found ${listings.length} listings on this page for "${args.query}" (${radiusKm.toFixed(2)} km radius requested):\n\n${summary}\n\n${warnings.join("\n")}${continuation}` }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Error searching listings: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  };
}
