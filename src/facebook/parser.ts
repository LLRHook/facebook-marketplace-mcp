import type {
  MarketplaceListing,
  MarketplaceListingDetail,
  SearchResult,
} from "./types.js";

type JsonObject = Record<string, any>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

// Walk parsed JSON only. No script execution or evaluation of page content.
function* objects(root: unknown): Generator<JsonObject> {
  const queue = [root];
  const seen = new Set<unknown>();
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (isObject(current)) yield current;
    for (const value of Object.values(current)) queue.push(value);
  }
}

function listingFromEdge(edge: unknown): JsonObject | undefined {
  if (!isObject(edge) || !isObject(edge.node)) return undefined;
  return isObject(edge.node.listing) ? edge.node.listing : edge.node;
}

function isListing(node: unknown): node is JsonObject {
  return isObject(node) && typeof node.id === "string" && node.id.length > 0 &&
    typeof node.marketplace_listing_title === "string" &&
    node.marketplace_listing_title.length > 0;
}

function hasNoResultsStory(root: unknown): boolean {
  for (const node of objects(root)) {
    if (node.__typename === "EntMarketplaceSearchFeedNoResults") return true;
  }
  return false;
}

function findListingConnection(root: JsonObject): JsonObject {
  // Keep known empty connections distinct from an unknown response shape.
  const known = root.marketplace_search?.feed_units ??
    root.viewer?.marketplace_feed_stories;
  if (known !== undefined) {
    if (!isObject(known) || !Array.isArray(known.edges)) {
      throw new Error("Marketplace returned a malformed listing connection.");
    }
    return known;
  }
  for (const node of objects(root)) {
    if (Array.isArray(node.edges) &&
        node.edges.some((edge: unknown) => isListing(listingFromEdge(edge)))) {
      return node;
    }
  }
  if (hasNoResultsStory(root)) return { edges: [] };
  throw new Error("Marketplace search response has an unrecognized format.");
}

function postedDate(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function normalizeListing(node: JsonObject): MarketplaceListing {
  const price = node.listing_price;
  return {
    id: node.id,
    title: node.marketplace_listing_title,
    price: text(price?.formatted_amount_zeros_stripped) ||
      text(price?.formatted_amount) ||
      (typeof price?.amount === "number" || typeof price?.amount === "string"
        ? String(price.amount) : "N/A"),
    location: text(node.location_text?.text) ||
      text(node.location?.reverse_geocode?.city_page?.display_name) ||
      text(node.location?.reverse_geocode?.city, "Unknown"),
    imageUrl: text(node.primary_listing_photo?.image?.uri),
    sellerName: text(node.marketplace_listing_seller?.name, "Unknown"),
    postedDate: postedDate(node.creation_time),
    url: `https://www.facebook.com/marketplace/item/${encodeURIComponent(node.id)}/`,
    isPending: node.is_pending === true,
  };
}

export function parseSearchResponse(response: unknown): SearchResult {
  if (!isObject(response) || !isObject(response.data)) {
    throw new Error("Marketplace search response is missing data.");
  }
  const connection = findListingConnection(response.data);
  const listings = connection.edges
    .map(listingFromEdge)
    .filter(isListing)
    .map(normalizeListing) as MarketplaceListing[];
  if (connection.edges.length > 0 && listings.length === 0 &&
      !hasNoResultsStory(connection)) {
    throw new Error("Marketplace search contained no recognizable listings.");
  }
  const pageInfo = connection.page_info;
  if (pageInfo != null && (!isObject(pageInfo) ||
      (pageInfo.has_next_page != null && typeof pageInfo.has_next_page !== "boolean") ||
      (pageInfo.end_cursor != null && typeof pageInfo.end_cursor !== "string"))) {
    throw new Error("Marketplace returned malformed pagination data.");
  }
  return {
    listings,
    hasNextPage: pageInfo?.has_next_page ?? false,
    endCursor: pageInfo?.end_cursor ?? null,
  };
}

export function parseLocationResponse(response: unknown):
  Array<{ name: string; latitude: number; longitude: number }> {
  const connection = isObject(response)
    ? response.data?.city_street_search?.street_results : undefined;
  if (!isObject(connection) || !Array.isArray(connection.edges)) {
    throw new Error("Marketplace location response has an unrecognized format.");
  }
  const results = connection.edges.flatMap((edge: unknown) => {
    const node = isObject(edge) ? edge.node : undefined;
    if (!isObject(node)) return [];
    const name = text(node.single_line_address) || text(node.subtitle);
    const latitude = node.location?.latitude;
    const longitude = node.location?.longitude;
    if (!name || typeof latitude !== "number" || !Number.isFinite(latitude) ||
        Math.abs(latitude) > 90 || typeof longitude !== "number" ||
        !Number.isFinite(longitude) || Math.abs(longitude) > 180) return [];
    return [{ name, latitude, longitude }];
  });
  if (connection.edges.length > 0 && results.length === 0) {
    throw new Error("Marketplace location response contained no valid coordinates.");
  }
  return results;
}

// Relay fragments for the requested ID fill gaps; other listings never act as fallbacks.
function mergeFragments(target: JsonObject, source: JsonObject): void {
  for (const [key, value] of Object.entries(source)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype" ||
        value === null || value === undefined) continue;
    if (isObject(value)) {
      if (!isObject(target[key])) target[key] = Object.create(null);
      mergeFragments(target[key], value);
    } else if (Array.isArray(value)) {
      const existing = Array.isArray(target[key]) ? target[key] : [];
      target[key] = [...existing, ...value];
    } else if (target[key] == null || target[key] === "") {
      target[key] = value;
    }
  }
}

function detailFromPayloads(payloads: unknown[], listingId: string): MarketplaceListingDetail {
  const listingIds = new Set([listingId]);
  // The public route may use product_item.id while Relay uses a separate listing ID.
  // Discover that explicit link first so fragments preceding it are included too.
  for (const payload of payloads) {
    for (const node of objects(payload)) {
      if (isObject(node.product_item) && node.product_item.id === listingId &&
          typeof node.id === "string" && node.id.length > 0) {
        listingIds.add(node.id);
      }
    }
  }
  const merged: JsonObject = Object.create(null);
  for (const payload of payloads) {
    for (const node of objects(payload)) {
      if (listingIds.has(node.id)) mergeFragments(merged, node);
    }
  }
  if (!isListing(merged)) {
    throw new Error("The requested listing was not found in the page data. It may be unavailable, require login, or use a changed page format.");
  }
  const base = normalizeListing({ ...merged, id: listingId });
  const images = new Set<string>();
  if (base.imageUrl) images.add(base.imageUrl);
  for (const photos of [merged.listing_photos, merged.marketplace_listing_photos]) {
    if (!photos || typeof photos !== "object") continue;
    for (const photo of objects(photos)) {
      const uri = text(photo.image?.uri);
      if (uri) images.add(uri);
    }
  }
  const seller = merged.marketplace_listing_seller;
  const conditionAttribute = Array.isArray(merged.attribute_data)
    ? merged.attribute_data.find((entry: unknown) => isObject(entry) && entry.attribute_name === "Condition")
    : undefined;
  return {
    ...base,
    description: text(merged.redacted_description?.text) ||
      text(merged.description?.text) || text(merged.description),
    images: [...images],
    imageUrl: base.imageUrl || [...images][0] || "",
    condition: text(merged.condition_text?.text) ||
      text(merged.condition_text) || text(merged.condition) || text(conditionAttribute?.label),
    seller: {
      name: text(seller?.name),
      profileUrl: text(seller?.id)
        ? `https://www.facebook.com/${encodeURIComponent(seller.id)}` : "",
    },
  };
}

export function parseListingDetailResponse(
  response: unknown,
  listingId: string,
): MarketplaceListingDetail {
  return detailFromPayloads([response], listingId);
}

export function parseListingDetailFromPage(
  html: string,
  listingId: string,
): MarketplaceListingDetail {
  const payloads: unknown[] = [];
  for (const block of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\btype\s*=\s*["']application\/json["']/i.test(block[1])) continue;
    try {
      payloads.push(JSON.parse(block[2]));
    } catch {
      // Ignore unrelated malformed script blocks; require valid target data below.
    }
  }
  return detailFromPayloads(payloads, listingId);
}
