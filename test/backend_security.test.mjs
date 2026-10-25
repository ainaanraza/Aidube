// test/backend_security.test.mjs
// Automated verification test suite for Aidube backend security controls

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scrubSecrets } from "../api/_lib/keys.js";
import { checkRateLimit, getClientIp } from "../api/_lib/rateLimit.js";
import {
  isValidVideoId,
  isValidPlaylistId,
  sanitizeSearchQuery,
  sanitizeMaxResults,
  checkPayloadSize,
  validateGeminiInput,
  ALLOWED_GEMINI_ACTIONS
} from "../api/_lib/validation.js";
import { applyCorsAndSecurityHeaders, validateOrigin, sendSafeError } from "../api/_lib/security.js";
import youtubeHandler from "../api/youtube.js";
import geminiHandler from "../api/gemini.js";
import researchHandler from "../api/research.js";

// Mock Response object for testing serverless handlers
function createMockRes() {
  const headers = {};
  let statusCode = 200;
  let jsonBody = null;
  let ended = false;

  const res = {
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    status(code) { statusCode = code; return res; },
    json(data) { jsonBody = data; ended = true; return res; },
    end() { ended = true; return res; },
    _getStatusCode() { return statusCode; },
    _getJson() { return jsonBody; },
    _getHeaders() { return headers; }
  };
  return res;
}

describe("Security Controls: Secret Scrubbing", () => {
  it("should redact Google AIzaSy keys from strings", () => {
    const mockKey = "AIzaSy" + "MockKeyForScrubbingTestOnly12345";
    const raw = `Error calling https://generativelanguage.googleapis.com?key=${mockKey} failed`;
    const scrubbed = scrubSecrets(raw);
    assert.strictEqual(scrubbed.includes(mockKey), false);
    assert.ok(scrubbed.includes("[REDACTED_API_KEY]") || scrubbed.includes("[REDACTED]"));
  });

  it("should redact URL query key parameters", () => {
    const rawUrl = "https://www.googleapis.com/youtube/v3/search?part=snippet&key=secret123456789&q=test";
    const scrubbed = scrubSecrets(rawUrl);
    assert.strictEqual(scrubbed.includes("secret123456789"), false);
    assert.ok(scrubbed.includes("[REDACTED]"));
  });
});

describe("Security Controls: Input Validation & Sanitization", () => {
  it("should validate YouTube playlist IDs correctly", () => {
    assert.strictEqual(isValidPlaylistId("PL1234567890abcdef"), true);
    assert.strictEqual(isValidPlaylistId("UU1234567890abcdef"), true);
    assert.strictEqual(isValidPlaylistId("FL1234567890abcdef"), true);
    // Invalid IDs: video IDs, SQL injection attempts, path traversal
    assert.strictEqual(isValidPlaylistId("dQw4w9WgXcQ"), false);
    assert.strictEqual(isValidPlaylistId("PL123'; DROP TABLE users;--"), false);
    assert.strictEqual(isValidPlaylistId("../../../etc/passwd"), false);
    assert.strictEqual(isValidPlaylistId(""), false);
  });

  it("should validate YouTube video IDs strictly (11 chars alphanum)", () => {
    assert.strictEqual(isValidVideoId("dQw4w9WgXcQ"), true);
    assert.strictEqual(isValidVideoId("12345678901"), true);
    // Invalid
    assert.strictEqual(isValidVideoId("short"), false);
    assert.strictEqual(isValidVideoId("too_long_video_id_here"), false);
    assert.strictEqual(isValidVideoId("<script>alert(1)</script>"), false);
    assert.strictEqual(isValidVideoId(null), false);
  });

  it("should sanitize search query and strip control characters", () => {
    const dirty = "  Learn Python\x00\x1F programming  ";
    const clean = sanitizeSearchQuery(dirty);
    assert.strictEqual(clean, "Learn Python programming");
  });

  it("should cap maxResults between 1 and 50", () => {
    assert.strictEqual(sanitizeMaxResults(100), 50);
    assert.strictEqual(sanitizeMaxResults(-5), 50);
    assert.strictEqual(sanitizeMaxResults("25"), 25);
  });

  it("should validate Gemini payload action and input limits", () => {
    // Missing action
    assert.strictEqual(validateGeminiInput({}).valid, false);

    // Unsupported action
    assert.strictEqual(validateGeminiInput({ action: "unsupportedAction" }).valid, false);

    // Valid generate
    const validGen = validateGeminiInput({ action: "generate", prompt: "Summarize this lesson" });
    assert.strictEqual(validGen.valid, true);

    // Oversized prompt (>30k chars)
    const giantPrompt = "A".repeat(35000);
    const invalidGen = validateGeminiInput({ action: "generate", prompt: giantPrompt });
    assert.strictEqual(invalidGen.valid, false);
  });

  it("should normalize unknown/unsupported model names to official stable modern models", () => {
    const validResult = validateGeminiInput({ action: "generate", prompt: "Test prompt", model: "gemini-3.8-flash" });
    assert.strictEqual(validResult.valid, true);
    assert.strictEqual(validResult.data.model, "gemini-3.8-flash");

    const fallbackResult = validateGeminiInput({ action: "generate", prompt: "Test prompt", model: "unsupported-model-xyz" });
    assert.strictEqual(fallbackResult.valid, true);
    assert.strictEqual(fallbackResult.data.model, "gemini-3.8-flash");
  });

  it("should enforce maximum payload size (64KB)", () => {
    const smallReq = { headers: { "content-length": "500" }, body: { prompt: "hi" } };
    assert.strictEqual(checkPayloadSize(smallReq, 65536), true);

    const oversizedReq = { headers: { "content-length": "70000" }, body: {} };
    assert.strictEqual(checkPayloadSize(oversizedReq, 65536), false);
  });
});

describe("Security Controls: CORS & Origin Protection", () => {
  it("should allow verified Aidube production and development origins", () => {
    assert.strictEqual(validateOrigin({ headers: { origin: "https://aidube.com" } }).allowed, true);
    assert.strictEqual(validateOrigin({ headers: { origin: "https://learn.aidube.com" } }).allowed, true);
    assert.strictEqual(validateOrigin({ headers: { origin: "https://aidube.vercel.app" } }).allowed, true);
    assert.strictEqual(validateOrigin({ headers: { origin: "http://localhost:3000" } }).allowed, true);
    assert.strictEqual(validateOrigin({ headers: { origin: "http://127.0.0.1:5000" } }).allowed, true);
  });

  it("should reject untrusted third-party origins", () => {
    assert.strictEqual(validateOrigin({ headers: { origin: "https://malicious.evil.com" } }).allowed, false);
    assert.strictEqual(validateOrigin({ headers: { origin: "https://attacker.org" } }).allowed, false);
    assert.strictEqual(validateOrigin({ headers: { origin: "http://fake-aidube.com" } }).allowed, false);
  });

  it("Gemini handler: should reject requests from untrusted origins with 403 Forbidden", async () => {
    const req = {
      method: "POST",
      headers: { origin: "https://attacker.com" },
      body: { action: "generate", prompt: "Hello" }
    };
    const res = createMockRes();

    await geminiHandler(req, res);
    assert.strictEqual(res._getStatusCode(), 403);
    assert.ok(res._getJson().error.includes("Untrusted Origin"));
  });

  it("YouTube handler: should reject requests from untrusted origins with 403 Forbidden", async () => {
    const req = {
      method: "GET",
      headers: { origin: "https://attacker.com" },
      query: { action: "searchPlaylists", q: "python" }
    };
    const res = createMockRes();

    await youtubeHandler(req, res);
    assert.strictEqual(res._getStatusCode(), 403);
    assert.ok(res._getJson().error.includes("Untrusted Origin"));
  });
});

describe("Security Controls: Rate Limiting & Edge IP Spoofing Prevention", () => {
  it("should prioritize verified x-real-ip header over x-forwarded-for to prevent IP spoofing", () => {
    const req = {
      headers: {
        "x-real-ip": "203.0.113.195",
        "x-forwarded-for": "198.51.100.1, 10.0.0.1"
      }
    };
    assert.strictEqual(getClientIp(req), "203.0.113.195");
  });

  it("should allow requests under the limit and block once threshold is exceeded", async () => {
    const mockReq = { headers: { "x-real-ip": "198.51.100.77" } };
    const prefix = `test_rate_${Date.now()}`;

    // Limit to 3 requests
    const res1 = await checkRateLimit(mockReq, { limit: 3, windowMs: 10000, bucketPrefix: prefix });
    assert.strictEqual(res1.allowed, true);
    assert.strictEqual(res1.remaining, 2);

    const res2 = await checkRateLimit(mockReq, { limit: 3, windowMs: 10000, bucketPrefix: prefix });
    assert.strictEqual(res2.allowed, true);
    assert.strictEqual(res2.remaining, 1);

    const res3 = await checkRateLimit(mockReq, { limit: 3, windowMs: 10000, bucketPrefix: prefix });
    assert.strictEqual(res3.allowed, true);
    assert.strictEqual(res3.remaining, 0);

    // 4th request must be blocked
    const res4 = await checkRateLimit(mockReq, { limit: 3, windowMs: 10000, bucketPrefix: prefix });
    assert.strictEqual(res4.allowed, false);
    assert.strictEqual(res4.remaining, 0);
  });
});

describe("Security Controls: Endpoint Handlers & Method Enforcement", () => {
  it("YouTube handler: should reject unsupported HTTP methods (e.g. DELETE)", async () => {
    const req = { method: "DELETE", headers: {}, query: {} };
    const res = createMockRes();

    await youtubeHandler(req, res);
    assert.strictEqual(res._getStatusCode(), 405);
  });

  it("YouTube handler: should reject requests with missing or invalid action", async () => {
    const req = { method: "GET", headers: {}, query: { action: "unknown" } };
    const res = createMockRes();

    await youtubeHandler(req, res);
    assert.strictEqual(res._getStatusCode(), 400);
  });

  it("YouTube handler: should reject playlistItems with invalid playlistId format", async () => {
    const req = { method: "GET", headers: {}, query: { action: "playlistItems", playlistId: "invalid_id" } };
    const res = createMockRes();

    await youtubeHandler(req, res);
    assert.strictEqual(res._getStatusCode(), 400);
    assert.ok(res._getJson().error.includes("Invalid playlistId format"));
  });

  it("Gemini handler: should reject non-POST methods (e.g. GET)", async () => {
    const req = { method: "GET", headers: {}, body: {} };
    const res = createMockRes();

    await geminiHandler(req, res);
    assert.strictEqual(res._getStatusCode(), 405);
  });

  it("Gemini handler: should reject invalid action payloads", async () => {
    const req = { method: "POST", headers: {}, body: { action: "hackSystem" } };
    const res = createMockRes();

    await geminiHandler(req, res);
    assert.strictEqual(res._getStatusCode(), 400);
  });

  it("Gemini handler: should reject oversized request body with 413", async () => {
    const req = {
      method: "POST",
      headers: { "content-length": "80000" },
      body: { action: "generate", prompt: "Hello" }
    };
    const res = createMockRes();

    await geminiHandler(req, res);
    assert.strictEqual(res._getStatusCode(), 413);
  });

  it("Gemini handler: safe failure when keys are not configured", async () => {
    const oldKey = process.env.GEMINI_API_KEY;
    const oldKeys = process.env.GEMINI_API_KEYS;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEYS;

    const req = { method: "POST", headers: {}, body: { action: "generate", prompt: "Hello" } };
    const res = createMockRes();

    await geminiHandler(req, res);
    assert.strictEqual(res._getStatusCode(), 500);
    assert.ok(res._getJson().error);
    assert.strictEqual(res._getJson().error.includes("AIza"), false);

    process.env.GEMINI_API_KEY = oldKey;
    process.env.GEMINI_API_KEYS = oldKeys;
  });

  it("YouTube handler: safe failure when keys are not configured", async () => {
    const oldKey = process.env.YOUTUBE_API_KEY;
    const oldKeys = process.env.YOUTUBE_API_KEYS;
    delete process.env.YOUTUBE_API_KEY;
    delete process.env.YOUTUBE_API_KEYS;

    const req = { method: "GET", headers: {}, query: { action: "searchPlaylists", q: "python" } };
    const res = createMockRes();

    await youtubeHandler(req, res);
    assert.strictEqual(res._getStatusCode(), 500);
    assert.ok(res._getJson().error);
    assert.strictEqual(res._getJson().error.includes("AIza"), false);

    process.env.YOUTUBE_API_KEY = oldKey;
    process.env.YOUTUBE_API_KEYS = oldKeys;
  });

  it("Research handler: should forward legacy { topic } payload safely", async () => {
    const oldKey = process.env.GEMINI_API_KEY;
    const oldKeys = process.env.GEMINI_API_KEYS;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEYS;

    const req = { method: "POST", headers: {}, body: { topic: "Quantum Computing" } };
    const res = createMockRes();

    await researchHandler(req, res);
    // Should pass validation and fail at missing key (500) rather than 400 invalid action
    assert.strictEqual(res._getStatusCode(), 500);
    assert.strictEqual(res._getJson().error.includes("AIza"), false);

    process.env.GEMINI_API_KEY = oldKey;
    process.env.GEMINI_API_KEYS = oldKeys;
  });
});
