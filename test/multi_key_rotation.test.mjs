// test/multi_key_rotation.test.mjs
// Automated verification suite for multiple API key rotation, bounded retries, and quota handling

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import {
  parseKeys,
  getGeminiKeys,
  getYouTubeKeys,
  getRotatingKeys,
  resetKeyIndexes,
  markKeyExhausted,
  markKeySuccess,
  classifyGeminiError,
  classifyYouTubeError,
  scrubSecrets
} from "../api/_lib/keys.js";

import { callGeminiApi } from "../api/gemini.js";
import { fetchYouTubeWithRotation } from "../api/youtube.js";
import geminiHandler from "../api/gemini.js";
import youtubeHandler from "../api/youtube.js";

function createMockRes() {
  const headers = {};
  let statusCode = 200;
  let jsonBody = null;

  const res = {
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    status(code) { statusCode = code; return res; },
    json(data) { jsonBody = data; return res; },
    end() { return res; },
    _getStatusCode() { return statusCode; },
    _getJson() { return jsonBody; },
    _getHeaders() { return headers; }
  };
  return res;
}

describe("Multi-Key Rotation & Quota Fallback Test Suite", () => {
  const originalFetch = globalThis.fetch;
  const envBackup = { ...process.env };

  beforeEach(() => {
    resetKeyIndexes();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...envBackup };
    resetKeyIndexes();
  });

  // 1. A single key succeeds without fallback
  it("Case 1: Single key succeeds without fallback", async () => {
    process.env.GEMINI_API_KEY = "single_gemini_key_12345";
    delete process.env.GEMINI_API_KEYS;

    let fetchCount = 0;
    globalThis.fetch = async (url) => {
      fetchCount++;
      assert.ok(url.includes("single_gemini_key_12345"));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "Generated answer successfully" }] } }]
        })
      };
    };

    const result = await callGeminiApi({ prompt: "Test prompt" });
    assert.strictEqual(result.text, "Generated answer successfully");
    assert.strictEqual(fetchCount, 1);
  });

  // 2. The first Gemini key fails with a retryable quota error and the second succeeds
  it("Case 2: First Gemini key fails with 429 quota error and second succeeds", async () => {
    process.env.GEMINI_API_KEYS = "gemini_key_alpha_111, gemini_key_beta_222";
    delete process.env.GEMINI_API_KEY;

    let calls = [];
    globalThis.fetch = async (url) => {
      if (url.includes("gemini_key_alpha_111")) {
        calls.push("key_alpha");
        return {
          ok: false,
          status: 429,
          json: async () => ({
            error: { status: "RESOURCE_EXHAUSTED", message: "Resource has been exhausted (quota exceeded)" }
          })
        };
      }
      if (url.includes("gemini_key_beta_222")) {
        calls.push("key_beta");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "Fallback key worked!" }] } }]
          })
        };
      }
      throw new Error("Unexpected key: " + url);
    };

    const result = await callGeminiApi({ prompt: "Test fallback" });
    assert.strictEqual(result.text, "Fallback key worked!");
    assert.deepStrictEqual(calls, ["key_alpha", "key_beta"]);
  });

  // 3. All Gemini keys fail and the response is safely sanitized
  it("Case 3: All Gemini keys fail and error message is safely sanitized", async () => {
    process.env.GEMINI_API_KEYS = "gemini_key_one_333, gemini_key_two_444";
    delete process.env.GEMINI_API_KEY;

    globalThis.fetch = async (url) => {
      return {
        ok: false,
        status: 429,
        json: async () => ({
          error: { message: `Quota exceeded on ${url}` }
        })
      };
    };

    await assert.rejects(
      async () => {
        await callGeminiApi({ prompt: "Should fail" });
      },
      (err) => {
        assert.ok(!err.message.includes("gemini_key_one_333"));
        assert.ok(!err.message.includes("gemini_key_two_444"));
        assert.ok(err.message.includes("quota") || err.message.includes("exceeded"));
        return true;
      }
    );
  });

  // 4. The first YouTube key exhausts its per-key quota and the next succeeds
  it("Case 4: First YouTube key exhausts quota and second succeeds", async () => {
    process.env.YOUTUBE_API_KEYS = "yt_key_primary_111, yt_key_secondary_222";
    delete process.env.YOUTUBE_API_KEY;

    let ytCalls = [];
    globalThis.fetch = async (url) => {
      if (url.includes("yt_key_primary_111")) {
        ytCalls.push("primary");
        return {
          ok: false,
          status: 403,
          json: async () => ({
            error: {
              code: 403,
              message: "The request cannot be completed because you have exceeded your quota.",
              errors: [{ reason: "quotaExceeded", message: "quotaExceeded" }]
            }
          })
        };
      }
      if (url.includes("yt_key_secondary_222")) {
        ytCalls.push("secondary");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: { playlistId: "PL12345" }, snippet: { title: "Learning Node" } }]
          })
        };
      }
      throw new Error("Unexpected URL in fetch: " + url);
    };

    const data = await fetchYouTubeWithRotation(key => `https://www.googleapis.com/youtube/v3/search?key=${key}`);
    assert.strictEqual(data.items.length, 1);
    assert.deepStrictEqual(ytCalls, ["primary", "secondary"]);
  });

  // 5. YouTube project-level quota exhaustion terminates cleanly without endless retries
  it("Case 5: YouTube project-level quota exhaustion terminates cleanly", async () => {
    process.env.YOUTUBE_API_KEYS = "yt_proj_key_1, yt_proj_key_2";
    delete process.env.YOUTUBE_API_KEY;

    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      return {
        ok: false,
        status: 403,
        json: async () => ({
          error: {
            code: 403,
            message: "The request cannot be completed because you have exceeded your quota.",
            errors: [{ reason: "quotaExceeded" }]
          }
        })
      };
    };

    await assert.rejects(
      async () => {
        await fetchYouTubeWithRotation(k => `https://www.googleapis.com/youtube/v3/search?key=${k}`);
      },
      (err) => {
        assert.ok(err.message.includes("quota") || err.message.includes("exhausted"));
        return true;
      }
    );
    // Bounded attempts: exactly the number of configured keys (2), not looping
    assert.strictEqual(attempts, 2);
  });

  // 6. Invalid credentials handled without infinite retry loop
  it("Case 6: Invalid credentials handled without an infinite retry loop", async () => {
    process.env.GEMINI_API_KEYS = "invalid_gemini_key_1, invalid_gemini_key_2";
    delete process.env.GEMINI_API_KEY;

    let attemptCount = 0;
    globalThis.fetch = async () => {
      attemptCount++;
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            code: 400,
            status: "INVALID_ARGUMENT",
            message: "API key not valid. Please pass a valid API key."
          }
        })
      };
    };

    await assert.rejects(
      async () => {
        await callGeminiApi({ prompt: "Test invalid key" });
      },
      (err) => {
        assert.ok(err.message.includes("invalid") || err.message.includes("Failed"));
        return true;
      }
    );
    // Verified: exactly 2 attempts, terminating cleanly
    assert.strictEqual(attemptCount, 2);
  });

  // 7. Invalid input does not trigger unnecessary key rotation
  it("Case 7: Invalid input does not trigger key rotation or upstream requests", async () => {
    process.env.YOUTUBE_API_KEY = "dummy_yt_key_valid";
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const req = {
      method: "GET",
      headers: {},
      query: { action: "playlistItems", playlistId: "malicious';DROP TABLE users;--" }
    };
    const res = createMockRes();
    await youtubeHandler(req, res);

    assert.strictEqual(res._getStatusCode(), 400);
    assert.strictEqual(fetchCalled, false);
  });

  // 8. Temporary upstream failures follow defined bounded retry policy
  it("Case 8: Temporary upstream server failures (503) do not exhaust all keys blindly", async () => {
    process.env.GEMINI_API_KEYS = "key_srv_111, key_srv_222, key_srv_333";
    delete process.env.GEMINI_API_KEY;

    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return {
        ok: false,
        status: 503,
        json: async () => ({
          error: { message: "The service is currently unavailable." }
        })
      };
    };

    await assert.rejects(async () => {
      await callGeminiApi({ prompt: "Server error test" });
    });

    // Upstream 503 is not a key-specific quota error, so it should not burn through all remaining keys
    assert.strictEqual(callCount, 1);
  });

  // 9. Comma-separated values parsed correctly with spaces, duplicates, and empty entries
  it("Case 9: Comma-separated values parsed correctly with spaces, duplicates, and empty entries", () => {
    process.env.TEST_SINGLE = " primary_key_1 ";
    process.env.TEST_POOL = "  primary_key_1, key_two_222 ,  , key_three_333, key_two_222, short ";

    const parsed = parseKeys("TEST_SINGLE", "TEST_POOL");
    assert.deepStrictEqual(parsed, [
      "primary_key_1",
      "key_two_222",
      "key_three_333"
    ]);
  });

  // 10. Singular and plural environment variables behave as documented
  it("Case 10: Singular and plural environment variables behave as documented", () => {
    // Only singular
    process.env.GEMINI_API_KEY = "gemini_single_only";
    delete process.env.GEMINI_API_KEYS;
    assert.deepStrictEqual(getGeminiKeys(), ["gemini_single_only"]);

    // Only plural
    delete process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEYS = "gemini_pool_1, gemini_pool_2";
    assert.deepStrictEqual(getGeminiKeys(), ["gemini_pool_1", "gemini_pool_2"]);

    // Both (singular placed first as primary)
    process.env.GEMINI_API_KEY = "gemini_primary";
    process.env.GEMINI_API_KEYS = "gemini_secondary, gemini_primary";
    assert.deepStrictEqual(getGeminiKeys(), ["gemini_primary", "gemini_secondary"]);
  });

  // 11. Gemini keys are never used for YouTube requests, and vice versa
  it("Case 11: Gemini keys are never used for YouTube requests, and vice versa", async () => {
    process.env.GEMINI_API_KEY = "gemini_exclusive_secret_999";
    process.env.YOUTUBE_API_KEY = "youtube_exclusive_secret_888";

    let geminiUrl = "";
    let ytUrl = "";

    globalThis.fetch = async (url) => {
      if (url.includes("generativelanguage.googleapis.com")) {
        geminiUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({ candidates: [{ content: { parts: [{ text: "Gemini Ok" }] } }] })
        };
      }
      if (url.includes("googleapis.com/youtube")) {
        ytUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [] })
        };
      }
      throw new Error("Unknown host: " + url);
    };

    await callGeminiApi({ prompt: "Hello" });
    await fetchYouTubeWithRotation(k => `https://www.googleapis.com/youtube/v3/search?key=${k}`);

    assert.ok(geminiUrl.includes("gemini_exclusive_secret_999"));
    assert.ok(!geminiUrl.includes("youtube_exclusive_secret_888"));

    assert.ok(ytUrl.includes("youtube_exclusive_secret_888"));
    assert.ok(!ytUrl.includes("gemini_exclusive_secret_999"));
  });

  // 12. Error messages, test output, and logs never contain actual credentials
  it("Case 12: Error messages and outputs never contain actual credentials", () => {
    process.env.GEMINI_API_KEY = "AIzaSySecretGeminiKey123456789012345";
    process.env.YOUTUBE_API_KEY = "AIzaSySecretYouTubeKey12345678901234";

    const errorWithSecrets = "Failed connecting to https://generativelanguage.googleapis.com?key=AIzaSySecretGeminiKey123456789012345 and youtube key AIzaSySecretYouTubeKey12345678901234";
    const sanitized = scrubSecrets(errorWithSecrets);

    assert.strictEqual(sanitized.includes("AIzaSySecretGeminiKey123456789012345"), false);
    assert.strictEqual(sanitized.includes("AIzaSySecretYouTubeKey12345678901234"), false);
    assert.ok(sanitized.includes("[REDACTED_API_KEY]") || sanitized.includes("[REDACTED]"));
  });

  // 13. The retry limit is strictly enforced
  it("Case 13: Bounded retry limit is enforced even if 10 keys are configured", async () => {
    process.env.GEMINI_API_KEYS = "k1_123456, k2_123456, k3_123456, k4_123456, k5_123456, k6_123456, k7_123456, k8_123456, k9_123456, k10_123456";
    delete process.env.GEMINI_API_KEY;

    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      return {
        ok: false,
        status: 429,
        json: async () => ({ error: { message: "Quota exceeded" } })
      };
    };

    await assert.rejects(async () => {
      await callGeminiApi({ prompt: "Bounded retry test" });
    });

    // Bounded to 3 attempts max per logical request
    assert.strictEqual(attempts, 3);
  });

  // 14. Existing Aidube AI and YouTube features continue to work
  it("Case 14: Existing Aidube AI features and YouTube actions continue to work", async () => {
    process.env.GEMINI_API_KEY = "gemini_feature_test_key";
    process.env.YOUTUBE_API_KEY = "youtube_feature_test_key";

    globalThis.fetch = async (url, opts) => {
      if (url.includes("generativelanguage.googleapis.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{ text: JSON.stringify([{ question: "What is React?", options: ["A", "B", "C", "D"], correctAnswer: 0 }]) }]
              }
            }]
          })
        };
      }
      if (url.includes("googleapis.com/youtube")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: { playlistId: "PL_test_123" }, snippet: { title: "Python Basics" } }
            ]
          })
        };
      }
      throw new Error("Unhandled URL: " + url);
    };

    // Test Gemini test generation action
    const geminiReq = {
      method: "POST",
      headers: { origin: "https://aidube.com" },
      body: { action: "test", title: "React", questionCount: 1 }
    };
    const geminiRes = createMockRes();
    await geminiHandler(geminiReq, geminiRes);
    assert.strictEqual(geminiRes._getStatusCode(), 200);
    assert.ok(geminiRes._getJson().questions);

    // Test YouTube searchPlaylists action
    const ytReq = {
      method: "GET",
      headers: { origin: "https://aidube.com" },
      query: { action: "searchPlaylists", q: "Python" }
    };
    const ytRes = createMockRes();
    await youtubeHandler(ytReq, ytRes);
    assert.strictEqual(ytRes._getStatusCode(), 200);
    assert.ok(ytRes._getJson().items.length > 0);
  });

  // 15. Serverless state rotation: advancing container index after exhaustion
  it("Case 15: Serverless container state rotation advances after exhaustion", async () => {
    process.env.GEMINI_API_KEYS = "container_key_A_111, container_key_B_222, container_key_C_333";
    delete process.env.GEMINI_API_KEY;

    let usedKeys = [];
    globalThis.fetch = async (url) => {
      const match = url.match(/container_key_[ABC]_\d+/);
      const k = match ? match[0] : "unknown";
      usedKeys.push(k);

      if (k.includes("container_key_A_111")) {
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: { message: "Quota exceeded on key A" } })
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: `Response from ${k}` }] } }]
        })
      };
    };

    // Request 1: Key A fails, falls back to Key B and succeeds
    const res1 = await callGeminiApi({ prompt: "Request 1" });
    assert.strictEqual(res1.text, "Response from container_key_B_222");
    assert.deepStrictEqual(usedKeys, ["container_key_A_111", "container_key_B_222"]);

    // Request 2 on same warm serverless instance: Starts directly with working Key B!
    usedKeys = [];
    const res2 = await callGeminiApi({ prompt: "Request 2" });
    assert.strictEqual(res2.text, "Response from container_key_B_222");
    // Verified: Key A was NOT tried again because index advanced to B
    assert.deepStrictEqual(usedKeys, ["container_key_B_222"]);
  });
});
