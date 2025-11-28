const { test, describe } = require("node:test");
const assert = require("node:assert");
const {
  normalizeCategory,
  extractJson,
  diffResults,
  mergeStateData,
  CATEGORY_KEYS,
  stateToGeoId
} = require("../scripts/lib/personhood-logic");

describe("Personhood Logic", () => {
  
  describe("normalizeCategory", () => {
    test("should normalize standard categories", () => {
      assert.strictEqual(normalizeCategory("ENACTED_ANTI_PERSONHOOD"), "ENACTED_ANTI_PERSONHOOD");
    });

    test("should normalize aliases", () => {
      assert.strictEqual(normalizeCategory("Enacted"), "ENACTED_ANTI_PERSONHOOD");
      assert.strictEqual(normalizeCategory("Failed"), "FAILED_ATTEMPTS");
      assert.strictEqual(normalizeCategory("pending"), "PENDING_LEGISLATION");
    });

    test("should default to NO_SPECIFIC_ACTION for unknown inputs", () => {
      assert.strictEqual(normalizeCategory("Something Random"), "NO_SPECIFIC_ACTION");
      assert.strictEqual(normalizeCategory(""), "NO_SPECIFIC_ACTION");
      assert.strictEqual(normalizeCategory(null), "NO_SPECIFIC_ACTION");
    });
  });

  describe("extractJson", () => {
    test("should extract clean JSON", () => {
      const input = '{"foo": "bar"}';
      assert.strictEqual(extractJson(input), input);
    });

    test("should extract JSON from markdown code blocks", () => {
      const input = "Here is the result:\n```json\n{\n  \"relevant\": true\n}\n```";
      const expected = '{\n  "relevant": true\n}';
      assert.strictEqual(extractJson(input), expected);
    });

    test("should extract JSON from surrounding text without blocks", () => {
      const input = "Sure, here is the JSON: {\"a\": 1} hope that helps.";
      assert.strictEqual(extractJson(input), "{\"a\": 1}");
    });

    test("should throw error if no JSON found", () => {
      assert.throws(() => extractJson("Just text"), /Unable to parse JSON/);
    });
  });

  describe("diffResults", () => {
    test("should return empty list if no changes", () => {
      const current = [{ bill_id: 1, change_hash: "abc" }];
      const history = { 1: { change_hash: "abc" } };
      const diff = diffResults(current, history);
      assert.strictEqual(diff.length, 0);
    });

    test("should return new bills", () => {
      const current = [{ bill_id: 1, change_hash: "abc" }];
      const history = {};
      const diff = diffResults(current, history);
      assert.strictEqual(diff.length, 1);
      assert.strictEqual(diff[0].bill_id, 1);
    });

    test("should return updated bills (hash mismatch)", () => {
      const current = [{ bill_id: 1, change_hash: "def" }];
      const history = { 1: { change_hash: "abc" } };
      const diff = diffResults(current, history);
      assert.strictEqual(diff.length, 1);
      assert.strictEqual(diff[0].change_hash, "def");
    });
  });

  describe("mergeStateData", () => {
    test("should prioritize ENACTED over PENDING", () => {
      const previous = {
        "US-WA": { category: "PENDING_LEGISLATION", summary: "Old" }
      };
      const updates = [
        { state: "WA", category: "ENACTED_ANTI_PERSONHOOD", summary: "New" }
      ];
      const result = mergeStateData(previous, updates);
      assert.strictEqual(result["US-WA"].category, "ENACTED_ANTI_PERSONHOOD");
      assert.strictEqual(result["US-WA"].summary, "New");
    });

    test("should NOT overwrite ENACTED with FAILED", () => {
      const previous = {
        "US-WA": { category: "ENACTED_ANTI_PERSONHOOD", summary: "Law" }
      };
      const updates = [
        { state: "WA", category: "FAILED_ATTEMPTS", summary: "Failed bill" }
      ];
      const result = mergeStateData(previous, updates);
      assert.strictEqual(result["US-WA"].category, "ENACTED_ANTI_PERSONHOOD");
      assert.strictEqual(result["US-WA"].summary, "Law");
    });

    test("should add new states", () => {
      const previous = {};
      const updates = [
        { state: "NY", category: "PENDING_LEGISLATION", summary: "Bill" }
      ];
      const result = mergeStateData(previous, updates);
      assert.strictEqual(result["US-NY"].category, "PENDING_LEGISLATION");
    });

    test("should ignore invalid states", () => {
      const previous = {};
      const updates = [
        { state: "XX", category: "PENDING_LEGISLATION" }
      ];
      const result = mergeStateData(previous, updates);
      assert.strictEqual(Object.keys(result).length, 0);
    });
  });
});
