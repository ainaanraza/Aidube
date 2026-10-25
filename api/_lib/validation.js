// api/_lib/validation.js
// Strict validation and schema enforcement for serverless endpoints

const SAFE_ALPHANUM_REGEX = /^[a-zA-Z0-9_-]+$/;
const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const PLAYLIST_ID_REGEX = /^(PL|UU|FL)[a-zA-Z0-9_-]{10,64}$/;

export function sanitizeString(val, maxLength = 255) {
  if (typeof val !== "string") return "";
  return val.trim().slice(0, maxLength);
}

export function isValidVideoId(id) {
  if (typeof id !== "string") return false;
  return VIDEO_ID_REGEX.test(id.trim());
}

export function isValidPlaylistId(id) {
  if (typeof id !== "string") return false;
  return PLAYLIST_ID_REGEX.test(id.trim());
}

export function sanitizeSearchQuery(q) {
  if (typeof q !== "string") return "";
  // Strip null bytes and control chars, cap at 200 characters
  return q.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, 200);
}

export function sanitizeMaxResults(val, defaultVal = 50, maxAllowed = 50) {
  const num = parseInt(val, 10);
  if (isNaN(num) || num < 1) return defaultVal;
  return Math.min(num, maxAllowed);
}

export function sanitizePageToken(token) {
  if (!token || typeof token !== "string") return "";
  const clean = token.trim();
  if (clean.length > 64 || !SAFE_ALPHANUM_REGEX.test(clean)) return "";
  return clean;
}

export function checkPayloadSize(req, maxBytes = 65536) {
  const contentLength = parseInt(req.headers["content-length"], 10);
  if (!isNaN(contentLength) && contentLength > maxBytes) {
    return false;
  }
  if (req.body && typeof req.body === "object") {
    try {
      const size = JSON.stringify(req.body).length;
      if (size > maxBytes) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export const ALLOWED_GEMINI_ACTIONS = ["generate", "test", "roadmap", "subtopics", "research", "models"];
export const ALLOWED_GEMINI_MODELS = [
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
  "gemini-1.5-pro",
  "gemini-2.0-flash"
];

export function validateGeminiInput(body) {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Invalid JSON request body" };
  }

  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  if (!ALLOWED_GEMINI_ACTIONS.includes(action)) {
    return { valid: false, error: `Invalid action. Supported actions: ${ALLOWED_GEMINI_ACTIONS.join(", ")}` };
  }

  let model = "gemini-1.5-flash";
  if (body.model && typeof body.model === "string") {
    let requested = body.model.trim();
    // Use valid official model, or gracefully normalize any fictional/unsupported name (e.g. gemini-3.8-flash)
    if (ALLOWED_GEMINI_MODELS.includes(requested)) {
      model = requested;
    } else {
      model = "gemini-1.5-flash";
    }
  }

  if (action === "generate") {
    if (!body.prompt || typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
      return { valid: false, error: "Missing required 'prompt' string" };
    }
    if (body.prompt.length > 30000) {
      return { valid: false, error: "Prompt exceeds maximum length of 30,000 characters" };
    }
    const maxTokens = Math.min(Math.max(parseInt(body.maxTokens, 10) || 2000, 100), 8192);
    const temperature = Math.min(Math.max(parseFloat(body.temperature) || 0.2, 0.0), 1.0);
    return { valid: true, data: { action, prompt: body.prompt, maxTokens, temperature, model } };
  }

  if (action === "test") {
    const title = sanitizeString(body.title || "", 300);
    const videoId = sanitizeString(body.videoId || "", 20);
    const transcript = typeof body.transcript === "string" ? body.transcript.slice(0, 30000) : "";
    const questionCount = Math.min(Math.max(parseInt(body.questionCount, 10) || 3, 1), 10);
    return { valid: true, data: { action, title, videoId, transcript, questionCount, model } };
  }

  if (action === "roadmap") {
    const topic = sanitizeString(body.topic || "", 200);
    if (!topic) {
      return { valid: false, error: "Missing required 'topic'" };
    }
    const level = ["beginner", "intermediate", "advanced"].includes(body.level) ? body.level : "beginner";
    let excludedTopics = [];
    if (Array.isArray(body.excludedTopics)) {
      excludedTopics = body.excludedTopics
        .map(t => sanitizeString(t, 100))
        .filter(Boolean)
        .slice(0, 20);
    }
    return { valid: true, data: { action, topic, level, excludedTopics, model } };
  }

  if (action === "subtopics") {
    const topic = sanitizeString(body.topic || "", 200);
    if (!topic) {
      return { valid: false, error: "Missing required 'topic'" };
    }
    const level = ["beginner", "intermediate", "advanced"].includes(body.level) ? body.level : "beginner";
    return { valid: true, data: { action, topic, level, model } };
  }

  if (action === "research") {
    const topic = sanitizeString(body.topic || "", 200);
    if (!topic) {
      return { valid: false, error: "Missing required 'topic'" };
    }
    return { valid: true, data: { action, topic, model } };
  }

  return { valid: false, error: "Unhandled action" };
}
