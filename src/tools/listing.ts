import { z } from "zod";
import type { FacebookClient } from "../facebook/client.js";
import { analyzePrice } from "../facebook/listing-analysis.js";

export const getListingSchema = {
  listing_id: z.string().describe("Facebook Marketplace listing ID"),
};

export function createListingHandler(client: FacebookClient) {
  return async (args: { listing_id: string }) => {
    try {
      const listing = await client.getListingDetail(args.listing_id);
      const priceReview = analyzePrice(listing, listing.description);

      const parts = [
        `# ${listing.title}`,
        "",
        `**Price:** ${listing.price}`,
        ...priceReview.warnings.map(warning => `**Price review:** ${warning}`),
        listing.condition ? `**Condition:** ${listing.condition}` : null,
        `**Location:** ${listing.location}`,
        listing.isPending ? "**Status:** ⏳ Pending" : null,
        listing.isSold ? "**Status:** Sold" : null,
        "",
        listing.description
          ? `## Description\n${listing.description}`
          : null,
        "",
        `**Seller:** ${listing.seller.name}`,
        listing.seller.profileUrl
          ? `**Profile:** ${listing.seller.profileUrl}`
          : null,
        "",
        listing.images.length > 0
          ? `**Images:** ${listing.images.length} photo(s)\n${listing.images.map((u, i) => `  ${i + 1}. ${u}`).join("\n")}`
          : null,
        "",
        `🔗 ${listing.url}`,
      ]
        .filter(Boolean)
        .join("\n");

      return {
        structuredContent: { listing, priceReview },
        content: [{ type: "text" as const, text: parts }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error fetching listing: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  };
}
