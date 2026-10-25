// api/_lib/keys.js
// Server-side credential management with quota-fallback rotation

function parseKeys(singleEnvName, poolEnvName) {
  const single = process.env[singleEnvName] || "";
  const pool = process.env[poolEnvName] || "";
  const raw = `${single},${pool}`.replace(/["']/g, "");
  const keys = raw
    .split(",")
    .map(k => k.trim())
    .filter(k => k && k.length > 5);
  // Remove duplicates while preserving order
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
  return keys[geminiKeyIndex % keys.length];
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
  return keys[youtubeKeyIndex % keys.length];
}

export function rotateYouTubeKey() {
  const keys = getYouTubeKeys();
  if (keys.length > 0) {
    youtubeKeyIndex = (youtubeKeyIndex + 1) % keys.length;
  }
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
