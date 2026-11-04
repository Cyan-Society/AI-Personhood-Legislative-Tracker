const { test, describe } = require("node:test");
const assert = require("node:assert");
const {
  buildClassificationPrompt,
  buildGenerateContentRequest,
  parseClassification,
  buildBatchBody,
  readBatchStatus,
  readBatchResults
} = require("../scripts/lib/gemini");

const modelReply = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });

describe("Gemini helpers", () => {
  describe("buildClassificationPrompt", () => {
    test("should include the bill data and the last action", () => {
      const prompt = buildClassificationPrompt({
        state: "OH",
        bill_number: "HB469",
        title: "AI personhood",
        history: [{ action: "Introduced" }, { action: "Referred to committee" }]
      });
      assert.match(prompt, /"bill_number":"HB469"/);
      assert.match(prompt, /"last_action":"Referred to committee"/);
    });
  });

  describe("buildGenerateContentRequest", () => {
    test("should set the thinking level in upper case", () => {
      const request = buildGenerateContentRequest("hi", "high");
      assert.deepStrictEqual(request.generationConfig, { thinkingConfig: { thinkingLevel: "HIGH" } });
      assert.strictEqual(request.contents[0].parts[0].text, "hi");
    });

    test("should leave out generationConfig when no thinking level is given", () => {
      assert.strictEqual(buildGenerateContentRequest("hi", "").generationConfig, undefined);
    });
  });

  describe("parseClassification", () => {
    test("should parse a fenced JSON reply", () => {
      const reply = modelReply('```json\n{"relevant": true, "category": "pending", "summary": "S", "reason": "R"}\n```');
      assert.deepStrictEqual(parseClassification(reply), {
        relevant: true,
        category: "PENDING_LEGISLATION",
        summary: "S",
        reason: "R"
      });
    });

    test("should ignore thought parts", () => {
      const reply = {
        candidates: [{ content: { parts: [{ thought: true, text: "{not json" }, { text: '{"relevant": false}' }] } }]
      };
      assert.strictEqual(parseClassification(reply).relevant, false);
    });

    test("should throw when there is no JSON", () => {
      assert.throws(() => parseClassification(modelReply("no idea")));
    });
  });

  describe("buildBatchBody", () => {
    test("should wrap requests with string keys in the documented shape", () => {
      const body = buildBatchBody([{ key: 123, request: { contents: [] } }], "run-1");
      assert.strictEqual(body.batch.display_name, "run-1");
      assert.deepStrictEqual(body.batch.input_config.requests.requests, [
        { request: { contents: [] }, metadata: { key: "123" } }
      ]);
    });
  });

  describe("readBatchStatus", () => {
    test("should treat pending and running jobs as not done", () => {
      assert.deepStrictEqual(readBatchStatus({ metadata: { state: "JOB_STATE_PENDING" } }), {
        state: "JOB_STATE_PENDING",
        done: false,
        succeeded: false
      });
      assert.strictEqual(readBatchStatus({ done: false, metadata: { state: "JOB_STATE_RUNNING" } }).done, false);
    });

    test("should recognize success", () => {
      const status = readBatchStatus({ done: true, metadata: { state: "JOB_STATE_SUCCEEDED" } });
      assert.strictEqual(status.done, true);
      assert.strictEqual(status.succeeded, true);
    });

    test("should handle the BATCH_STATE_* names the live API returns", () => {
      assert.strictEqual(readBatchStatus({ metadata: { state: "BATCH_STATE_RUNNING" } }).done, false);
      const status = readBatchStatus({ done: true, metadata: { state: "BATCH_STATE_SUCCEEDED" } });
      assert.strictEqual(status.succeeded, true);
    });

    test("should recognize failed, cancelled and expired jobs", () => {
      for (const state of ["JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED", "BATCH_STATE_FAILED"]) {
        const status = readBatchStatus({ metadata: { state } });
        assert.strictEqual(status.done, true, state);
        assert.strictEqual(status.succeeded, false, state);
      }
    });

    test("should not count a finished job with an error as success", () => {
      assert.strictEqual(readBatchStatus({ done: true, error: { message: "boom" } }).succeeded, false);
    });
  });

  describe("readBatchResults", () => {
    test("should read nested inlinedResponses with keys and errors", () => {
      const operation = {
        response: {
          inlinedResponses: {
            inlinedResponses: [
              { metadata: { key: "1" }, response: modelReply('{"relevant": true}') },
              { metadata: { key: "2" }, error: { message: "quota" } }
            ]
          }
        }
      };
      const results = readBatchResults(operation);
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].key, "1");
      assert.ok(results[0].response);
      assert.deepStrictEqual(results[1].error, { message: "quota" });
    });

    test("should accept a flat array and fall back to index when keys are missing", () => {
      const results = readBatchResults({ response: { inlinedResponses: [{ response: {} }] } });
      assert.strictEqual(results[0].key, null);
      assert.strictEqual(results[0].index, 0);
    });

    test("should throw when results come back as a file", () => {
      assert.throws(() => readBatchResults({ response: { responsesFile: "files/abc" } }), /results file/);
    });
  });
});
