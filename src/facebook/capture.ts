export interface CapturedQuery {
  docId: string;
  operationName: string;
  variables: unknown;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, /token|cookie|password|authorization|fb_dtsg|jazoest|^lsd$/i.test(key) ? "<REDACTED>" : redact(entry)]));
}

export function parseCapturedQuery(url: string, postData: string): CapturedQuery | null {
  try {
    const target = new URL(url);
    if (target.origin !== "https://www.facebook.com" || target.pathname !== "/api/graphql/") return null;
    const body = new URLSearchParams(postData);
    const docId = body.get("doc_id");
    if (!docId || !/^\d+$/.test(docId)) return null;
    const variables = JSON.parse(body.get("variables") ?? "{}");
    let operationName: string;
    if (variables?.params?.bqf?.callsite === "COMMERCE_MKTPLACE_WWW") operationName = "marketplace_search";
    else if (variables?.params?.caller === "MARKETPLACE") operationName = "city_street_search";
    else if (/Marketplace.*(?:Item|Listing)/i.test(body.get("fb_api_req_friendly_name") ?? "") && variables?.targetId) operationName = "listing_detail";
    else return null;
    return { docId, operationName, variables: redact(variables) };
  } catch { return null; }
}
