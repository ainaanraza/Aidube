// api/_lib/keys.js
// Server-side credential management with quota-fallback rotation and structured error classification

export function parseKeys(singleEnvName, poolEnvName) {
  const single = process.env[singleEnvName] || "";
  const pool = process.env[poolEnvName] || "";
  const raw = `${single},${pool}`.replace(/["']/g, "");
  const keys = raw
    .split(",")
    .map(k => k.trim())
    .filter(k => k && k.length > 5);
  // Remove duplicates while preserving insertion order
  return Array.from(new Set(keys));
}

let geminiKeyIndex = 0;
let youtubeKeyIndex = 0;

export function getGeminiKeys() {
  return parseKeys("GEMINI_API_KEY", "GEMINI_API_KEYS");
}

export function getYouTubeKeys() {
  return parseKeys("YOUTUBE_API_KEY", "YOUTUBE_API_KEYS");
}

export function getCurrentGeminiKey() {
  const keys = getGeminiKeys();
  if (keys.length === 0) return null;
  return keys[Math.abs(geminiKeyIndex) % keys.length];
}

export function rotateGeminiKey() {
  const keys = getGeminiKeys();
  if (keys.length > 0) {
    geminiKeyIndex = (geminiKeyIndex + 1) % keys.length;
  }
}

export function getCurrentYouTubeKey() {
  const keys = getYouTubeKeys();
  if (keys.length === 0) return null;
  return keys[Math.abs(youtubeKeyIndex) % keys.length];
}

export function rotateYouTubeKey() {
  const keys = getYouTubeKeys();
  if (keys.length > 0) {
    youtubeKeyIndex = (youtubeKeyIndex + 1) % keys.length;
  }
}

/**
 * Returns an ordered array of unique keys for a single logical request,
 * starting with the currently active key in the serverless instance.
 */
export function getRotatingKeys(type = "gemini") {
  const keys = type === "gemini" ? getGeminiKeys() : getYouTubeKeys();
  if (keys.length === 0) return [];
  const index = type === "gemini" ? geminiKeyIndex : youtubeKeyIndex;
  const startIndex = Math.abs(index) % keys.length;
  const ordered = [];
  for (let i = 0; i < keys.length; i++) {
    ordered.push(keys[(startIndex + i) % keys.length]);
  }
  return ordered;
}

/**
 * Marks a key as exhausted/failed with quota and advances the container's
 * starting key index so subsequent incoming requests start with the next available key.
 */
export function markKeyExhausted(type = "gemini", exhaustedKey) {
  const keys = type === "gemini" ? getGeminiKeys() : getYouTubeKeys();
  const idx = keys.indexOf(exhaustedKey);
  if (idx !== -1) {
    if (type === "gemini") {
      geminiKeyIndex = (idx + 1) % keys.length;
    } else {
      youtubeKeyIndex = (idx + 1) % keys.length;
    }
  }
}

/**
 * Marks a key as successful and maintains the container index on that working key.
 */
export function markKeySuccess(type = "gemini", successfulKey) {
  const keys = type === "gemini" ? getGeminiKeys() : getYouTubeKeys();
  const idx = keys.indexOf(successfulKey);
  if (idx !== -1) {
    if (type === "gemini") {
      geminiKeyIndex = idx;
    } else {
      youtubeKeyIndex = idx;
    }
  }
}

/**
 * Resets key rotation indexes (primarily used for unit testing).
 */
export function resetKeyIndexes() {
  geminiKeyIndex = 0;
  youtubeKeyIndex = 0;
}

/**
 * Classifies Google Gemini Generative Language API errors to determine
 * whether a failure is retryable with an alternative key.
 */
export function classifyGeminiError(status, errBody = {}) {
  const errorObj = errBody.error || errBody;
  const message = (errorObj.message || "").toLowerCase();
  const errorStatus = (errorObj.status || "").toUpperCase();
  const details = JSON.stringify(errorObj.details || "");

  // 1. Quota exhaustion or rate limiting
  if (
    status === 429 ||
    errorStatus === "RESOURCE_EXHAUSTED" ||
    message.includes("quota") ||
    message.includes("resource has been exhausted") ||
    message.includes("rate limit") ||
    details.includes("QUOTA")
  ) {
    return {
      retryableWithKey: true,
      reason: "QUOTA_EXHAUSTED",
      isQuota: true,
      message: "Gemini quota or rate limit exceeded on current key."
    };
  }

  // 2. Invalid or suspended API key
  if (
    (status === 400 || status === 403 || status === 401) &&
    (message.includes("api key not valid") ||
      message.includes("api_key_invalid") ||
      message.includes("api key expired") ||
      message.includes("apikey invalid") ||
      (errorStatus === "PERMISSION_DENIED" && message.includes("key")))
  ) {
    return {
      retryableWithKey: true,
      reason: "KEY_INVALID",
      isKeyInvalid: true,
      message: "Gemini API key is invalid or unauthorized."
    };
  }

  // 3. Model not found or unsupported model configuration (Model error, not key error)
  if (
    status === 404 ||
    (status === 400 && (message.includes("model") || message.includes("not found")))
  ) {
    return {
      retryableWithKey: false,
      reason: "MODEL_ERROR",
      isModelError: true,
      message: errorObj.message || "Requested Gemini model is unavailable."
    };
  }

  // 4. Invalid input / Request validation
  if (status === 400) {
    return {
      retryableWithKey: false,
      reason: "CLIENT_ERROR",
      isClientError: true,
      message: errorObj.message || "Invalid Gemini request parameters."
    };
  }

  // 5. Upstream server error (5xx)
  if (status >= 500) {
    return {
      retryableWithKey: false,
      reason: "UPSTREAM_ERROR",
      isUpstreamError: true,
      message: "Gemini upstream server temporary error."
    };
  }

  return {
    retryableWithKey: false,
    reason: "UNKNOWN",
    message: errorObj.message || `Gemini API error with status ${status}`
  };
}

/**
 * Classifies YouTube Data API v3 errors to determine
 * whether a failure is retryable with an alternative key.
 */
export function classifyYouTubeError(status, errBody = {}) {
  const errorObj = errBody.error || errBody;
  const errors = Array.isArray(errorObj.errors) ? errorObj.errors : [];
  const reasons = errors.map(e => e.reason || "").concat(errorObj.reason || "");
  const message = (errorObj.message || "").toLowerCase();

  // 1. Rate limiting (HTTP 429 or structured reasons)
  if (
    status === 429 ||
    reasons.includes("rateLimitExceeded") ||
    reasons.includes("userRateLimitExceeded")
  ) {
    return {
      retryableWithKey: true,
      reason: "RATE_LIMIT_EXCEEDED",
      isRateLimit: true,
      message: "YouTube API rate limit reached."
    };
  }

  // 2. Quota exhaustion (HTTP 403 with quota reasons)
  if (
    status === 403 &&
    (reasons.includes("quotaExceeded") ||
      reasons.includes("dailyLimitExceeded") ||
      message.includes("quota"))
  ) {
    return {
      retryableWithKey: true,
      reason: "QUOTA_EXCEEDED",
      isQuota: true,
      isProjectQuota: reasons.includes("quotaExceeded"),
      message: "YouTube API quota exceeded for key."
    };
  }

  // 3. Key invalid or unauthorized
  if (
    reasons.includes("keyInvalid") ||
    (reasons.includes("badRequest") && message.includes("api key")) ||
    ((status === 400 || status === 403) &&
      (message.includes("api key not valid") ||
        message.includes("api_key_invalid") ||
        message.includes("key is invalid")))
  ) {
    return {
      retryableWithKey: true,
      reason: "KEY_INVALID",
      isKeyInvalid: true,
      message: "YouTube API key is invalid or unauthorized."
    };
  }

  // 4. API not enabled on key's project
  if (reasons.includes("accessNotConfigured") || message.includes("accessnotconfigured")) {
    return {
      retryableWithKey: true,
      reason: "ACCESS_NOT_CONFIGURED",
      isKeyInvalid: true,
      message: "YouTube Data API is not enabled for this project key."
    };
  }

  // 5. Resource not found (HTTP 404) -> DO NOT retry keys
  if (
    status === 404 ||
    reasons.includes("playlistNotFound") ||
    reasons.includes("videoNotFound")
  ) {
    return {
      retryableWithKey: false,
      reason: "NOT_FOUND",
      isNotFound: true,
      message: errorObj.message || "Requested YouTube resource not found."
    };
  }

  // 6. Permission / feature disabled (HTTP 403 forbidden resource) -> DO NOT retry keys
  if (
    status === 403 &&
    (reasons.includes("commentsDisabled") ||
      reasons.includes("forbidden") ||
      reasons.includes("ipRefererBlocked"))
  ) {
    return {
      retryableWithKey: false,
      reason: "FORBIDDEN_RESOURCE",
      isForbidden: true,
      message: errorObj.message || "Access to requested YouTube resource is forbidden."
    };
  }

  // 7. Client parameter error (HTTP 400) -> DO NOT retry keys
  if (status === 400) {
    return {
      retryableWithKey: false,
      reason: "BAD_REQUEST",
      isClientError: true,
      message: errorObj.message || "Invalid YouTube API request parameters."
    };
  }

  // 8. Upstream server error (HTTP 5xx)
  if (status >= 500) {
    return {
      retryableWithKey: false,
      reason: "UPSTREAM_SERVER_ERROR",
      isUpstreamError: true,
      message: "YouTube upstream server temporary error."
    };
  }

  return {
    retryableWithKey: false,
    reason: "UNKNOWN",
    message: errorObj.message || `YouTube API error with status ${status}`
  };
}

// Security utility: Sanitizes any string or JSON structure to ensure no API key is leaked in output or logs
export function scrubSecrets(input) {
  if (!input) return input;
  const isString = typeof input === "string";
  let text = isString ? input : JSON.stringify(input);

  // Pattern for Google API Keys (AIzaSy...)
  text = text.replace(/AIza[0-9A-Za-z-_]{35}/g, "[REDACTED_API_KEY]");

  // Scrub known configured keys
  const allKnownKeys = [...getGeminiKeys(), ...getYouTubeKeys()];
  for (const k of allKnownKeys) {
    if (k && k.length > 8) {
      text = text.replaceAll(k, "[REDACTED_KEY]");
    }
  }

  // Scrub any key query param in URLs: ?key=... or &key=...
  text = text.replace(/([?&]key=)[^&\s"'\\]+/gi, "$1[REDACTED]");

  return isString ? text : JSON.parse(text);
}

