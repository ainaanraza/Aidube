// api/research.js
// Backward-compatible endpoint for research requests (/api/research)

import geminiHandler from "./gemini.js";

export default async function handler(req, res) {
  if (req.method === "POST" && req.body && req.body.topic && !req.body.action) {
    req.body.action = "research";
  }
  return geminiHandler(req, res);
}
