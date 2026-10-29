import { z } from "zod";
import type { FacebookClient } from "../facebook/client.js";
import { searchListingsSchema } from "./search.js";
import {
  addMonitor,
  loadMonitors,
  getMonitor,
  updateMonitorSeenIds,
  deleteMonitor,
} from "../storage/monitors.js";

const monitorName = z.string().trim().min(1).max(200);

export const monitorSearchSchema = {
  name: monitorName.describe("Name for this saved search monitor"),
  query: searchListingsSchema.query,
  latitude: searchListingsSchema.latitude,
  longitude: searchListingsSchema.longitude,
  radius_km: searchListingsSchema.radius_km.default(50),
  min_price: searchListingsSchema.min_price,
  max_price: searchListingsSchema.max_price,
  category: searchListingsSchema.category,
};

export const checkMonitorsSchema = {
  monitor_name: monitorName
    .optional()
    .describe("Check a specific monitor by name, or omit to check all"),
};

export const deleteMonitorSchema = {
  name: monitorName.describe("Name of the monitor to delete"),
};

export const listMonitorsSchema = {};

const monitorInput = z.object(monitorSearchSchema).refine(args =>
  args.min_price === undefined || args.max_price === undefined || args.min_price <= args.max_price,
  { message: "min_price cannot exceed max_price." });
const checkInput = z.object(checkMonitorsSchema);
const deleteInput = z.object(deleteMonitorSchema);

export function createMonitorSearchHandler() {
  return async (input: z.input<typeof monitorInput>) => {
    try {
      const args = monitorInput.parse(input);
      const monitor = addMonitor(args.name, {
        query: args.query,
        latitude: args.latitude,
        longitude: args.longitude,
        radiusKm: args.radius_km,
        minPrice: args.min_price,
        maxPrice: args.max_price,
        category: args.category,
        limit: 24,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Monitor "${monitor.name}" saved.\nID: ${monitor.id}\nQuery: "${args.query}" within ${args.radius_km}km\nUse check_monitors to check for new listings.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  };
}

export function createCheckMonitorsHandler(client: Pick<FacebookClient, "searchListings">) {
  return async (input: z.input<typeof checkInput>) => {
    try {
      const args = checkInput.parse(input);
      const monitors = args.monitor_name
        ? [getMonitor(args.monitor_name)].filter(Boolean)
        : loadMonitors();

      if (monitors.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: args.monitor_name
                ? `Monitor "${args.monitor_name}" not found.`
                : "No monitors saved. Use monitor_search to create one.",
            },
          ],
        };
      }

      const results: string[] = [];
      let hasErrors = false;

      for (const monitor of monitors) {
        if (!monitor) continue;

        try {
          const searchResult = await client.searchListings(monitor.params);
          const seen = new Set(monitor.seenIds);
          const newListings = searchResult.listings.filter(listing => {
            if (seen.has(listing.id)) return false;
            seen.add(listing.id);
            return true;
          });
          updateMonitorSeenIds(monitor.name, newListings.map(listing => listing.id));

          if (newListings.length > 0) {
            const listingSummary = newListings
              .map((listing, index) =>
                `  ${index + 1}. **${listing.title}** — ${listing.price}\n     📍 ${listing.location}\n     🔗 ${listing.url}`)
              .join("\n\n");
            results.push(
              `### 🔔 ${monitor.name} — ${newListings.length} listing(s) new to this monitor\n\n${listingSummary}`
            );
          } else {
            results.push(`### ${monitor.name} — no new listings`);
          }
        } catch (error) {
          hasErrors = true;
          results.push(`### ${monitor.name} — check failed\n${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return {
        content: [{ type: "text" as const, text: `${results.join("\n\n---\n\n")}\n\nEach monitor checks one result page. Newly seen IDs are not necessarily newly posted listings; this does not provide complete or real-time alerts.` }],
        ...(hasErrors ? { isError: true } : {}),
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error checking monitors: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  };
}

export function createDeleteMonitorHandler() {
  return async (input: z.input<typeof deleteInput>) => {
    try {
      const args = deleteInput.parse(input);
      const deleted = deleteMonitor(args.name);
      return { content: [{ type: "text" as const, text: deleted
        ? `Monitor "${args.name}" deleted.` : `Monitor "${args.name}" not found.` }] };
    } catch (error) {
      return { content: [{ type: "text" as const,
        text: `Error deleting monitor: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  };
}

export function createListMonitorsHandler() {
  return async () => {
    try {
      const monitors = loadMonitors();
      if (monitors.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No monitors saved. Use monitor_search to create one.",
            },
          ],
        };
      }

      const list = monitors
        .map(
          (m) =>
            `- **${m.name}** — "${m.params.query}" (${m.params.radiusKm}km)\n  Created: ${m.createdAt}${m.lastChecked ? ` | Last checked: ${m.lastChecked}` : ""}\n  Seen: ${m.seenIds.length} listings`
        )
        .join("\n\n");

      return {
        content: [{ type: "text" as const, text: `## Saved Monitors\n\n${list}` }],
      };
    } catch (error) {
      return { content: [{ type: "text" as const,
        text: `Error listing monitors: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  };
}
