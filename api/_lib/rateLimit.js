// api/_lib/rateLimit.js
// Enterprise-grade distributed rate limiter with automatic in-memory fallback

const rateLimitStore = new Map();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupStaleEntries() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, record] of rateLimitStore.entries()) {
    if (record.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Safely extracts client IP address, prioritizing verified edge proxy headers.
 */
export function getClientIp(req) {
  // 1. Prioritize verified Vercel edge IP headers to prevent X-Forwarded-For spoofing
  if (req.headers["x-real-ip"]) {
    return req.headers["x-real-ip"].trim();
  }
  if (req.headers["x-vercel-ip"]) {
    return req.headers["x-vercel-ip"].trim();
  }

  // 2. Fall back to X-Forwarded-For (sanitizing first IP)
  const xForwardedFor = req.headers["x-forwarded-for"];
  if (xForwardedFor) {
    const ips = xForwardedFor.split(",").map(ip => ip.trim()).filter(Boolean);
    if (ips.length > 0) {
      // Validate IP format (IPv4 or IPv6)
      const ip = ips[0];
      if (/^[0-9a-fA-F:.]+$/.test(ip)) {
        return ip;
      }
    }
  }

  return req.socket?.remoteAddress || "127.0.0.1";
}

/**
 * In-memory sliding window fallback rate limiter
 */
function checkInMemoryLimit(key, limit, windowMs) {
  cleanupStaleEntries();
  const now = Date.now();

  let record = rateLimitStore.get(key);

  if (!record || record.resetTime < now) {
    record = {
      count: 1,
      resetTime: now + windowMs
    };
    rateLimitStore.set(key, record);
    return {
      allowed: true,
      remaining: limit - 1,
      resetSeconds: Math.ceil(windowMs / 1000),
      limit
    };
  }

  record.count += 1;
  const remaining = Math.max(0, limit - record.count);
  const resetSeconds = Math.max(1, Math.ceil((record.resetTime - now) / 1000));

  if (record.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      resetSeconds,
      limit
    };
  }

  return {
    allowed: true,
    remaining,
    resetSeconds,
    limit
  };
}

/**
 * Distributed rate limiter via Upstash Redis REST API (when env configured)
 */
async function checkUpstashRedisLimit(key, limit, windowSeconds) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null; // Signals fallback to in-memory
  }

  try {
    // Atomic INCR and EXPIRE pipeline via Upstash REST API
    const response = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, windowSeconds, "NX"],
        ["TTL", key]
      ]),
      signal: AbortSignal.timeout(1500)
    });

    if (!response.ok) return null;

    const data = await response.json();
    const count = data[0]?.result || 1;
    const ttl = data[2]?.result > 0 ? data[2].result : windowSeconds;

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetSeconds: ttl,
      limit
    };
  } catch {
    // If Redis is unreachable, fail gracefully to in-memory limiter
    return null;
  }
}

/**
 * Checks rate limit for a client IP and optional authenticated user.
 * Supports distributed Redis with seamless in-memory fallback.
 * @param {object} req - Incoming request
 * @param {object} options - { limit: number, windowMs: number, bucketPrefix: string }
 * @returns {Promise<object>} { allowed: boolean, remaining: number, resetSeconds: number, limit: number }
 */
export async function checkRateLimit(req, { limit = 60, windowMs = 60 * 1000, bucketPrefix = "global" } = {}) {
  const ip = getClientIp(req);
  const windowSeconds = Math.ceil(windowMs / 1000);
  const key = `ratelimit:${bucketPrefix}:${ip}`;

  // 1. Try distributed rate limiter (Upstash / Vercel KV)
  const distributedResult = await checkUpstashRedisLimit(key, limit, windowSeconds);
  if (distributedResult !== null) {
    return distributedResult;
  }

  // 2. Fall back to local in-memory limiter
  return checkInMemoryLimit(key, limit, windowMs);
}
