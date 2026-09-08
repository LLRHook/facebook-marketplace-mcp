import assert from "node:assert/strict";
import test from "node:test";
import { parseCapturedQuery } from "../src/facebook/capture.js";

test("capture retains complete search variables but excludes auth form fields and redacts nested tokens", () => {
  const body = new URLSearchParams({ doc_id: "12345", fb_dtsg: "private-fixture", variables: JSON.stringify({ params: { bqf: { callsite: "COMMERCE_MKTPLACE_WWW", query: "desk" }, longField: "x".repeat(400), nested: { access_token: "private-fixture" } } }) });
  const result = parseCapturedQuery("https://www.facebook.com/api/graphql/", body.toString());
  assert.equal(result?.operationName, "marketplace_search");
  assert.match(JSON.stringify(result), new RegExp("x".repeat(400)));
  assert.ok(!JSON.stringify(result).includes("private-fixture"));
});

test("capture rejects foreign URLs, malformed variables and unrelated operations", () => {
  assert.equal(parseCapturedQuery("https://evil.test/api/graphql/", "doc_id=123"), null);
  assert.equal(parseCapturedQuery("https://www.facebook.com/api/graphql/", "doc_id=123&variables=invalid"), null);
  assert.equal(parseCapturedQuery("https://www.facebook.com/api/graphql/", "doc_id=123&variables=%7B%7D"), null);
});
