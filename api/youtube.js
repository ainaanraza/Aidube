// api/youtube.js
// Secure serverless endpoint for YouTube Data API v3 operations

import {
  getYouTubeKeys,
  getRotatingKeys,
  markKeyExhausted,
  markKeySuccess,
  classifyYouTubeError,
  scrubSecrets
} from "./_lib/keys.js";
import { applyCorsAndSecurityHeaders, handleOptions, sendSafeError, sendRateLimitHeaders } from "./_lib/security.js";
import { checkRateLimit } from "./_lib/rateLimit.js";
import {
  isValidVideoId,
  isValidPlaylistId,
  sanitizeSearchQuery,
  sanitizeMaxResults,
  sanitizePageToken,
  checkPayloadSize
} from "./_lib/validation.js";

// In-memory response cache to minimize YouTube quota usage
const youtubeCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function getCached(key) {
  const item = youtubeCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    youtubeCache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data) {
  // Cap cache size at 500 entries to prevent memory growth
  if (youtubeCache.size > 500) {
    const firstKey = youtubeCache.keys().next().value;
    youtubeCache.delete(firstKey);
  }
  youtubeCache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}

// Executes upstream YouTube API request with server-side key rotation and timeout
export async function fetchYouTubeWithRotation(urlBuilder) {
  const allKeys = getYouTubeKeys();
  if (allKeys.length === 0) {
    throw new Error("YOUTUBE_API_KEY is not configured on the server.");
  }

  const rotatingKeys = getRotatingKeys("youtube");
  const maxAttempts = Math.min(rotatingKeys.length, 3);
  let lastError = null;

  for (let i = 0; i < maxAttempts; i++) {
    const apiKey = rotatingKeys[i];
    const targetUrl = urlBuilder(apiKey);

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "Accept": "application/json"
        },
        signal: AbortSignal.timeout(7000) // 7-second timeout
      });

      if (response.ok) {
        markKeySuccess("youtube", apiKey);
        return await response.json();
      }

      const errJson = await response.json().catch(() => ({}));
      const classification = classifyYouTubeError(response.status, errJson);

      if (!classification.retryableWithKey) {
        // Non-retryable error: 400 Bad Request, 404 Not Found, 403 Forbidden Resource (e.g. commentsDisabled)
        // DO NOT retry with other keys!
        const safeMsg = scrubSecrets(classification.message);
        const err = new Error(safeMsg);
        err.status = response.status;
        err.isNonRetryable = true;
        err.isClientError = response.status === 400 || response.status === 404;
        throw err;
      }

      // Retryable with another key (Quota exceeded, Rate limit, Invalid key)
      markKeyExhausted("youtube", apiKey);
      lastError = new Error(scrubSecrets(classification.message));
    } catch (err) {
      if (err.isNonRetryable || err.isClientError || (err.status && err.status < 500 && err.status !== 403 && err.status !== 429)) {
        throw err;
      }
      lastError = err;
      markKeyExhausted("youtube", apiKey);
    }
  }

  throw lastError || new Error("All YouTube API keys exhausted.");
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  // Enforce strict Origin / CORS policy
  if (!applyCorsAndSecurityHeaders(req, res)) {
    return sendSafeError(res, 403, "Forbidden: Untrusted Origin disallowed by CORS policy.");
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return sendSafeError(res, 405, "Method Not Allowed. Use GET or POST.");
  }

  // Enforce payload size check on POST
  if (req.method === "POST" && !checkPayloadSize(req, 16384)) {
    return sendSafeError(res, 413, "Payload Too Large: Maximum request size is 16KB.");
  }

  // Rate Limiting: 60 requests per minute per IP
  const rateLimit = await checkRateLimit(req, { limit: 60, windowMs: 60 * 1000, bucketPrefix: "youtube" });
  sendRateLimitHeaders(res, rateLimit);

  if (!rateLimit.allowed) {
    return sendSafeError(res, 429, `Rate limit exceeded. Please wait ${rateLimit.resetSeconds}s.`);
  }

  // Support both GET query parameters and POST body
  const params = req.method === "POST" ? (req.body || {}) : req.query;
  const action = typeof params.action === "string" ? params.action.trim() : "";

  try {
    switch (action) {
      case "searchPlaylists": {
        const q = sanitizeSearchQuery(params.q);
        if (!q) {
          return sendSafeError(res, 400, "Missing or invalid search query 'q'.");
        }
        const maxResults = sanitizeMaxResults(params.maxResults, 50, 50);
        const cacheKey = `search:${q}:${maxResults}`;

        const cached = getCached(cacheKey);
        if (cached) {
          return res.status(200).json(cached);
        }

        const data = await fetchYouTubeWithRotation(key =>
          `https://www.googleapis.com/youtube/v3/search?part=snippet&type=playlist&q=${encodeURIComponent(q)}&maxResults=${maxResults}&key=${key}`
        );

        // Sanitize response to return only necessary fields
        const sanitizedResponse = {
          items: (data.items || []).map(item => ({
            id: item.id,
            snippet: item.snippet
          })),
          pageInfo: data.pageInfo || {}
        };

        setCache(cacheKey, sanitizedResponse);
        return res.status(200).json(sanitizedResponse);
      }

      case "playlistItems": {
        const playlistId = typeof params.playlistId === "string" ? params.playlistId.trim() : "";
        if (!isValidPlaylistId(playlistId)) {
          return sendSafeError(res, 400, "Invalid playlistId format.");
        }
        const pageToken = sanitizePageToken(params.pageToken);
        const maxResults = sanitizeMaxResults(params.maxResults, 50, 50);
        const cacheKey = `playlistItems:${playlistId}:${pageToken}:${maxResults}`;

        const cached = getCached(cacheKey);
        if (cached) {
          return res.status(200).json(cached);
        }

        const data = await fetchYouTubeWithRotation(key => {
          let url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${encodeURIComponent(playlistId)}&maxResults=${maxResults}&key=${key}`;
          if (pageToken) {
            url += `&pageToken=${encodeURIComponent(pageToken)}`;
          }
          return url;
        });

        const sanitizedResponse = {
          items: (data.items || []).map(item => ({
            id: item.id,
            snippet: item.snippet
          })),
          nextPageToken: data.nextPageToken || null,
          prevPageToken: data.prevPageToken || null,
          pageInfo: data.pageInfo || {}
        };

        setCache(cacheKey, sanitizedResponse);
        return res.status(200).json(sanitizedResponse);
      }

      case "videoDetails": {
        const videoId = typeof params.videoId === "string" ? params.videoId.trim() : "";
        if (!isValidVideoId(videoId)) {
          return sendSafeError(res, 400, "Invalid videoId format.");
        }
        const cacheKey = `video:${videoId}`;

        const cached = getCached(cacheKey);
        if (cached) {
          return res.status(200).json(cached);
        }

        const data = await fetchYouTubeWithRotation(key =>
          `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${key}`
        );

        const sanitizedResponse = {
          items: (data.items || []).map(item => ({
            id: item.id,
            snippet: item.snippet
          }))
        };

        setCache(cacheKey, sanitizedResponse);
        return res.status(200).json(sanitizedResponse);
      }

      case "playlistDetails": {
        const playlistId = typeof params.playlistId === "string" ? params.playlistId.trim() : "";
        if (!isValidPlaylistId(playlistId)) {
          return sendSafeError(res, 400, "Invalid playlistId format.");
        }
        const cacheKey = `playlistDetails:${playlistId}`;

        const cached = getCached(cacheKey);
        if (cached) {
          return res.status(200).json(cached);
        }

        const data = await fetchYouTubeWithRotation(key =>
          `https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${encodeURIComponent(playlistId)}&key=${key}`
        );

        const sanitizedResponse = {
          items: (data.items || []).map(item => ({
            id: item.id,
            snippet: item.snippet
          }))
        };

        setCache(cacheKey, sanitizedResponse);
        return res.status(200).json(sanitizedResponse);
      }

      default:
        return sendSafeError(res, 400, "Invalid action. Supported: searchPlaylists, playlistItems, videoDetails, playlistDetails.");
    }
  } catch (error) {
    if (error.name === "TimeoutError" || error.message?.includes("timeout")) {
      return sendSafeError(res, 504, "YouTube request timed out. Please try again.", error);
    }
    if (error.message?.includes("is not configured")) {
      return sendSafeError(res, 500, "YOUTUBE_API_KEY is not configured in Vercel environment variables.", error);
    }
    if (error.message?.includes("quota") || error.message?.includes("exhausted")) {
      return sendSafeError(res, 429, "YouTube API quota exceeded on server.", error);
    }
    if (error.message?.includes("key") && (error.message?.includes("invalid") || error.message?.includes("unauthorized"))) {
      return sendSafeError(res, 401, "Configured YOUTUBE_API_KEY is invalid in Google Cloud.", error);
    }
    return sendSafeError(res, 500, "Failed to retrieve YouTube data. Please try again later.", error);
  }
}
