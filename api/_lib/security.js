// api/_lib/security.js
// Security headers, CORS enforcement, and safe error responses

import { scrubSecrets } from "./keys.js";

// Allowed origins for CORS
const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/([a-z0-9-]+\.)?aidube\.com$/,
  /^https:\/\/aidube(-[a-z0-9-]+)?\.vercel\.app$/
];

/**
 * Validates the Origin header against allowed patterns.
 * @returns {object} { allowed: boolean, origin: string | null }
 */
export function validateOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) {
    // Non-browser or same-origin request
    return { allowed: true, origin: null };
  }

  const isAllowed = ALLOWED_ORIGIN_PATTERNS.some(pattern => pattern.test(origin));
  return {
    allowed: isAllowed,
    origin
  };
}

/**
 * Applies CORS and HTTP security headers.
 * If origin is present and untrusted, returns false so caller can reject with 403.
 */
export function applyCorsAndSecurityHeaders(req, res) {
  const { allowed, origin } = validateOrigin(req);

  // Apply Security Headers regardless of origin
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  if (!allowed) {
    // Untrusted origin: do not set CORS allow headers
    return false;
  }

  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-User-Id");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.setHeader("Vary", "Origin");
  }

  return true;
}

/**
 * Handles CORS OPTIONS preflight requests.
 */
export function handleOptions(req, res) {
  if (req.method === "OPTIONS") {
    const originCheck = validateOrigin(req);
    if (!originCheck.allowed) {
      res.status(403).end();
      return true;
    }
    applyCorsAndSecurityHeaders(req, res);
    res.status(204).end();
    return true;
  }
  return false;
}

export function sendRateLimitHeaders(res, rateLimitResult) {
  if (!rateLimitResult) return;
  res.setHeader("X-RateLimit-Limit", rateLimitResult.limit);
  res.setHeader("X-RateLimit-Remaining", rateLimitResult.remaining);
  res.setHeader("X-RateLimit-Reset", rateLimitResult.resetSeconds);
}

export function sendSafeError(res, statusCode, message, internalErr = null) {
  if (internalErr) {
    // Redact internal error log
    const safeLog = scrubSecrets(String(internalErr.stack || internalErr.message || internalErr));
    console.error(`[API Error ${statusCode}]`, safeLog);
  }

  const cleanMessage = scrubSecrets(message || "An unexpected error occurred.");
  return res.status(statusCode).json({
    error: cleanMessage,
    status: statusCode
  });
}
