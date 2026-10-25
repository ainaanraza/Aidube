// api/gemini.js
// Secure serverless endpoint for Google Gemini Generative Language API

import {
  getGeminiKeys,
  getCurrentGeminiKey,
  getRotatingKeys,
  markKeyExhausted,
  markKeySuccess,
  classifyGeminiError,
  scrubSecrets
} from "./_lib/keys.js";
import { applyCorsAndSecurityHeaders, handleOptions, sendSafeError, sendRateLimitHeaders } from "./_lib/security.js";
import { checkRateLimit } from "./_lib/rateLimit.js";
import { validateGeminiInput, checkPayloadSize, ALLOWED_GEMINI_MODELS } from "./_lib/validation.js";

// Executes upstream Gemini generateContent request with server-side key rotation and timeout
export async function callGeminiApi({ prompt, model = "gemini-3.1-flash-lite", maxOutputTokens = 2000, temperature = 0.2, responseMimeType = null }) {
  const allKeys = getGeminiKeys();
  if (allKeys.length === 0) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }

  // Candidate models: prioritize requested model, then models with active quotas and zero-latency
  const candidateModels = [
    model || "gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-2.5-flash"
  ].filter((m, idx, arr) => arr.indexOf(m) === idx);

  const candidateEndpoints = [];
  for (const m of candidateModels) {
    candidateEndpoints.push({ model: m, version: "v1beta" });
    candidateEndpoints.push({ model: m, version: "v1" });
  }

  const rotatingKeys = getRotatingKeys("gemini");
  const maxAttempts = Math.min(rotatingKeys.length, 3);
  let lastError = null;

  for (const { model: currentModel, version } of candidateEndpoints) {
    let modelAvailable = true;

    for (let i = 0; i < maxAttempts; i++) {
      const apiKey = rotatingKeys[i];
      const endpoint = `https://generativelanguage.googleapis.com/${version}/models/${currentModel}:generateContent?key=${apiKey}`;

      const requestBody = {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature,
          maxOutputTokens,
          thinkingConfig: {
            thinkingBudget: 0
          }
        }
      };

      if (responseMimeType) {
        requestBody.generationConfig.responseMimeType = responseMimeType;
      }

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(18000) // 18-second timeout
        });

        if (response.ok) {
          const data = await response.json();
          const candidate = data.candidates?.[0];
          const text = candidate?.content?.parts?.[0]?.text || "";
          markKeySuccess("gemini", apiKey);
          return { text, model: currentModel };
        }

        const errJson = await response.json().catch(() => ({}));
        const classification = classifyGeminiError(response.status, errJson);

        // If the model is not found, deprecated, unsupported, or overloaded:
        // Fall through to try the next candidate model in the chain!
        if (classification.isModelError) {
          modelAvailable = false;
          lastError = new Error(classification.message || `Model ${currentModel} returned error`);
          break; // Break inner loop across keys for this model, try next candidate model
        }

        // If this specific model exceeded its daily free tier quota (429), try next candidate model
        if (response.status === 429 && errJson?.error?.message?.includes("model:")) {
          modelAvailable = false;
          lastError = new Error(classification.message || `Model ${currentModel} quota exceeded`);
          break;
        }

        if (!classification.retryableWithKey) {
          // Non-retryable client error (e.g. invalid request format)
          // DO NOT burn remaining keys!
          const unretryableErr = new Error(scrubSecrets(classification.message));
          unretryableErr.isNonRetryable = true;
          unretryableErr.isClientError = classification.isClientError;
          unretryableErr.status = response.status;
          throw unretryableErr;
        }

        // Retryable with another key (Quota exceeded, Rate limit, Invalid key)
        markKeyExhausted("gemini", apiKey);
        lastError = new Error(scrubSecrets(classification.message));
      } catch (err) {
        if (err.isNonRetryable || err.isClientError) {
          throw err;
        }
        lastError = err;
        if (err.name !== "TimeoutError" && err.name !== "AbortError") {
          markKeyExhausted("gemini", apiKey);
        }
      }
    }

    if (modelAvailable && lastError && (lastError.message?.includes("invalid or unauthorized") || lastError.message?.includes("quota"))) {
      // If all keys were exhausted or invalid across this model, stop trying other models with same broken keys
      break;
    }
  }

  throw lastError || new Error("Failed to generate content from Gemini API.");
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  // Enforce strict Origin / CORS policy
  if (!applyCorsAndSecurityHeaders(req, res)) {
    return sendSafeError(res, 403, "Forbidden: Untrusted Origin disallowed by CORS policy.");
  }

  if (req.method !== "POST") {
    return sendSafeError(res, 405, "Method Not Allowed. Use POST.");
  }

  // Enforce payload size limit (64KB max)
  if (!checkPayloadSize(req, 65536)) {
    return sendSafeError(res, 413, "Payload Too Large: Maximum request size is 64KB.");
  }

  // Rate Limiting: 20 requests per minute per IP/identity
  const rateLimit = await checkRateLimit(req, { limit: 20, windowMs: 60 * 1000, bucketPrefix: "gemini" });
  sendRateLimitHeaders(res, rateLimit);

  if (!rateLimit.allowed) {
    return sendSafeError(res, 429, `Rate limit exceeded. Please wait ${rateLimit.resetSeconds}s before making another AI request.`);
  }

  // Input validation
  const validation = validateGeminiInput(req.body);
  if (!validation.valid) {
    return sendSafeError(res, 400, validation.error);
  }

  const { action, model } = validation.data;

  try {
    switch (action) {
      case "generate": {
        const { prompt, maxTokens, temperature } = validation.data;
        const result = await callGeminiApi({
          prompt,
          model,
          maxOutputTokens: maxTokens,
          temperature
        });
        return res.status(200).json({ text: result.text });
      }

      case "test": {
        const { title, transcript, questionCount } = validation.data;
        let promptContent = `Generate ${questionCount} multiple choice questions for "${title || 'this educational content'}".\n`;
        if (transcript) {
          promptContent += `\nUse this transcript excerpt as context:\n${transcript.slice(0, 15000)}\n`;
        }
        promptContent += `\nFormat: Return ONLY a valid JSON array of objects without markdown formatting or code blocks.
Each object must follow this exact schema:
[
  {
    "question": "Clear question text?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswer": 0
  }
]`;

        const result = await callGeminiApi({
          prompt: promptContent,
          model,
          maxOutputTokens: 2500,
          temperature: 0.2,
          responseMimeType: "application/json"
        });

        let cleanText = result.text.trim();
        cleanText = cleanText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
        const firstBracket = cleanText.indexOf("[");
        const lastBracket = cleanText.lastIndexOf("]");
        if (firstBracket !== -1 && lastBracket !== -1) {
          cleanText = cleanText.substring(firstBracket, lastBracket + 1);
        }

        let questions = [];
        try {
          questions = JSON.parse(cleanText);
        } catch {
          return sendSafeError(res, 502, "Failed to parse questions generated by AI. Please try again.");
        }

        return res.status(200).json({ questions });
      }

      case "roadmap": {
        const { topic, level, excludedTopics } = validation.data;
        let prompt = `Create a ${level} level learning roadmap for: "${topic}".`;
        if (excludedTopics && excludedTopics.length > 0) {
          prompt += ` Exclude these topics that the student already knows: ${excludedTopics.join(", ")}.`;
        }
        prompt += `\nProvide the roadmap as short ordered milestones, each on a new line. Focus on practical skill progression.`;

        const result = await callGeminiApi({
          prompt,
          model,
          maxOutputTokens: 2500,
          temperature: 0.3
        });

        const steps = result.text
          .split(/\r?\n/)
          .map(s => s.replace(/^[\s\-\*\d\.\)]+/, "").replace(/[`*_]{1,}/g, "").trim())
          .filter(s => s.length > 0 && !s.toLowerCase().includes("roadmap") && !s.toLowerCase().includes("learning path"));

        return res.status(200).json({
          text: result.text,
          steps
        });
      }

      case "subtopics": {
        const { topic, level } = validation.data;
        const prompt = `List the 10 most important subtopics for learning "${topic}" at a ${level} level.
Return ONLY the subtopic names, one per line, no numbering, no bullet points, no extra text.`;

        const result = await callGeminiApi({
          prompt,
          model,
          maxOutputTokens: 1000,
          temperature: 0.2
        });

        const topics = result.text
          .split(/\r?\n|,|;/)
          .map(t => t.replace(/^[\s\d\.\)\-\*]+/, "").replace(/[`*_]{1,}/g, "").trim())
          .filter(t => t.length > 0)
          .slice(0, 10);

        return res.status(200).json({ topics });
      }

      case "research": {
        const { topic } = validation.data;
        const prompt = `You are an expert AI educational assistant researching the topic: "${topic}".
Provide a comprehensive educational summary and at least 3 genuine educational web resources (tutorials, documentation, courses, articles) for learning this topic.

CRITICAL INSTRUCTIONS:
1. Provide a detailed, clean markdown summary with clear headings and bullet points.
2. For resources, provide direct, authoritative educational website URLs (e.g. https://www.example.com/topic).
3. DO NOT return relative URLs or redirect links.
4. Return ONLY a single valid JSON object without code blocks or extra text:
{
  "summary": "Detailed markdown explanation...",
  "resources": [
    {
      "title": "Resource Name",
      "url": "https://...",
      "snippet": "Short description of the resource."
    }
  ]
}`;

        const result = await callGeminiApi({
          prompt,
          model,
          maxOutputTokens: 4000,
          temperature: 0.2,
          responseMimeType: "application/json"
        });

        let cleanText = result.text.trim();
        cleanText = cleanText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
        const firstBrace = cleanText.indexOf("{");
        const lastBrace = cleanText.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1) {
          cleanText = cleanText.substring(firstBrace, lastBrace + 1);
        }

        try {
          const data = JSON.parse(cleanText);
          return res.status(200).json({
            topic,
            summary: data.summary || "Summary generated successfully.",
            resources: Array.isArray(data.resources) ? data.resources : []
          });
        } catch {
          return sendSafeError(res, 502, "Failed to parse research summary from AI. Please try again.");
        }
      }

      case "models": {
        const apiKey = getCurrentGeminiKey();
        if (!apiKey) {
          return sendSafeError(res, 500, "GEMINI_API_KEY is not configured.");
        }
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await r.json().catch(() => ({}));
        return res.status(r.status).json(scrubSecrets(data));
      }

      default:
        return sendSafeError(res, 400, "Unhandled action");
    }
  } catch (error) {
    if (error.name === "TimeoutError" || error.message?.includes("timeout")) {
      return sendSafeError(res, 504, "The AI request took a little too long. Please try again.", error);
    }
    if (error.message?.includes("is not configured")) {
      return sendSafeError(res, 500, "AI service configuration in progress. Please check back shortly.", error);
    }
    if (error.message?.includes("quota") || error.message?.includes("exhausted")) {
      return sendSafeError(res, 429, "Daily generation limit reached. Please try again later or add more credits.", error);
    }
    if (error.message?.includes("key") && (error.message?.includes("invalid") || error.message?.includes("unauthorized"))) {
      return sendSafeError(res, 401, "AI authentication error. Please refresh and try again.", error);
    }
    if (error.message?.includes("model") || error.message?.includes("found") || error.message?.includes("support")) {
      return sendSafeError(res, 503, "The AI service is currently busy. Please try again in a moment.", error);
    }
    return sendSafeError(res, 500, "Unable to generate content at this moment. Please try again shortly.", error);
  }
}
