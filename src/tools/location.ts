import { z } from "zod";
import type { FacebookClient } from "../facebook/client.js";

export const searchLocationSchema = {
  query: z
    .string()
    .trim().min(1).max(200)
    .describe(
      "Location search query (e.g. 'Dedham MA', 'Boston', 'Brooklyn NY')"
    ),
};

const inputSchema = z.object(searchLocationSchema);

export function createLocationHandler(client: Pick<FacebookClient, "searchLocation">) {
  return async (input: z.input<typeof inputSchema>) => {
    try {
      const args = inputSchema.parse(input);
      const results = await client.searchLocation(args.query);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No locations found for "${args.query}". Try a city or town name with state abbreviation.`,
            },
          ],
        };
      }

      const lines = results.map(
        (r, i) =>
          `${i + 1}. **${r.name}** — lat: ${r.latitude}, lng: ${r.longitude}`
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${results.length} location(s) for "${args.query}":\n\n${lines.join("\n")}\n\nUse these coordinates with search_listings.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error searching locations: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  };
}
