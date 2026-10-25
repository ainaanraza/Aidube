// api/gemini.js
// Secure serverless endpoint for Google Gemini Generative Language API

import {
  getGeminiKeys,
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
export async function callGeminiApi({ prompt, model = "gemini-1.5-flash", maxOutputTokens = 2000, temperature = 0.2, responseMimeType = null }) {
  const allKeys = getGeminiKeys();
  if (allKeys.length === 0) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }

  // Model fallback chain: requested model -> official stable models
  const candidateModels = [
    model || "gemini-1.5-flash",
    "gemini-1.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-pro"
  ].filter((m, idx, arr) => arr.indexOf(m) === idx);

  const rotatingKeys = getRotatingKeys("gemini");
  const maxAttempts = Math.min(rotatingKeys.length, 3);
  let lastError = null;

  for (const currentModel of candidateModels) {
    let modelAvailable = true;

    for (let i = 0; i < maxAttempts; i++) {
      const apiKey = rotatingKeys[i];
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;

      const requestBody = {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature,
          maxOutputTokens
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
          signal: AbortSignal.timeout(9000) // 9-second timeout
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

        if (classification.isModelError) {
          modelAvailable = false;
          lastError = new Error(classification.message);
          break; // Break inner loop, try next candidate model
        }

        if (!classification.retryableWithKey) {
          // Non-retryable error (e.g. client error or upstream 5xx temporary outage)
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
        markKeyExhausted("gemini", apiKey);
      }
    }

    if (modelAvailable && lastError && !lastError.message?.includes("model")) {
      // If the model was valid but keys were exhausted/invalid, do not repeat failed keys across models
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

      default:
        return sendSafeError(res, 400, "Unhandled action");
    }
  } catch (error) {
    if (error.name === "TimeoutError" || error.message?.includes("timeout")) {
      return sendSafeError(res, 504, "AI request timed out. Please try again.", error);
    }
    return sendSafeError(res, 500, "AI operation failed. Please try again later.", error);
  }
}
