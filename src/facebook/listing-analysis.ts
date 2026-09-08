import type { MarketplaceListing } from "./types.js";

export function distanceKm(latitude: number, longitude: number, otherLatitude: number, otherLongitude: number): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const a = Math.sin(radians(otherLatitude - latitude) / 2) ** 2 +
    Math.cos(radians(latitude)) * Math.cos(radians(otherLatitude)) *
    Math.sin(radians(otherLongitude - longitude) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

export function analyzePrice(listing: MarketplaceListing, description = "") {
  const warnings: string[] = [];
  // Use a display fallback only for a simple dollar amount; leave other formats unknown.
  const displayed = /^(?:US\$|\$)\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)$/.exec(listing.price);
  const candidate = listing.priceAmount ?? (displayed ? Number(displayed[1].replace(/,/g, "")) : null);
  const headlineAmount = candidate !== null && Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
  if (headlineAmount !== null && headlineAmount <= 1) {
    warnings.push("The headline price is 0 or 1; it may be a placeholder. Confirm the price and included items.");
  }
  const descriptionAmounts = [...new Set([...description.matchAll(/(?:US\$|\$)\s*([^\s$]+)/g)].flatMap(match => {
    const token = match[1].replace(/[),;.!?:]+$/, "");
    const tail = description.slice(match.index! + match[0].length);
    if (!/^\d+(?:,\d{3})*(?:\.\d{1,2})?$/.test(token) || /^\s*[kKmM]\b/.test(tail)) return [];
    const amount = Number(token.replace(/,/g, ""));
    return Number.isFinite(amount) ? [amount] : [];
  }))];
  if (headlineAmount !== null && descriptionAmounts.some(amount => amount !== headlineAmount)) {
    warnings.push("The description mentions different dollar amounts, which may price separate items or bundles. Confirm the total for the exact items you want.");
  }
  return { headlineAmount, descriptionAmounts, warnings };
}
