// js/research.js
import { GoogleGenerativeAI } from "https://cdn.jsdelivr.net/npm/@google/generative-ai/+esm";
import { getGeminiApiKey, rotateGeminiKey } from "./utils.js";

document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    const topic = params.get("topic");

    const topicTitleEl = document.getElementById("topicTitle");
    const loadingState = document.getElementById("loadingState");
    const errorState = document.getElementById("errorState");
    const resultState = document.getElementById("resultState");
    const markdownContent = document.getElementById("markdownContent");
    const resourcesContainer = document.getElementById("resourcesContainer");
    const errorMsg = document.getElementById("errorMsg");

    if (!topic) {
        topicTitleEl.textContent = "Unknown Topic";
        showError("No topic was specified for research. Please go back to the dashboard and try again.");
        return;
    }

    topicTitleEl.textContent = topic;

    // Start Research Process
    runResearchEngine(topic);

    async function runResearchEngine(searchTopic) {
        try {
            // Since app.py and frontend run on the same server, we can use relative path 
            // but if running on diff ports locally (e.g. 5500 for UI, 5000 for API)
            // we should explicitly point to localhost:5000 if not in prod. 
            // In a real Vercel deployment, the route might be rewritten.
            // Using a full URL for local testing assuming Flask is on 5000.

            // Note: If deployed, change this to an environment-aware fetch URL
            const apiUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
                ? 'http://localhost:5000/api/research'
                : '/api/research'; // For Vercel/Prod rewrites

            let data;
            try {
                const response = await fetch(apiUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ topic: searchTopic })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || `Server responded with ${response.status}`);
                }

                data = await response.json();
            } catch (serverError) {
                console.warn("Server API failed, using fallback:", serverError.message);
                data = await fallbackResearch(searchTopic);
            }

            // Render the results
            renderResults(data);

        } catch (error) {
            console.error("Research Error:", error);
            showError("Failed to generate research: " + error.message);
        }
    }

    async function fallbackResearch(searchTopic) {
        let lastError = null;
        for (let i = 0; i < 5; i++) {
            try {
                const genAI = new GoogleGenerativeAI(getGeminiApiKey());
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

                const prompt = `You are an AI research assistant. Provide a comprehensive educational summary about "${searchTopic}". 
Respond ONLY with a valid JSON document containing two keys:
1. "summary": A detailed markdown formatted text with headers, bullet points, and explanations. DO NOT use /grounding-api-redirect/ links.
2. "resources": An array of objects, each containing "title", "url" (CRITICAL: use absolute, direct, real URLs starting with https://; NEVER use relative or /grounding-api-redirect/ paths), and "snippet". Provide at least 3 resources.`;

                const result = await model.generateContent(prompt);
                let text = await result.response.text();

                // Fallback safeguard: if Gemini still returns relative grounding-api-redirect URLs
                text = text.replace(/(["']|\[.*?\]\()\/grounding-api-redirect\//g, '$1https://www.google.com/search/grounding-api-redirect/');

                if (text.startsWith("```json")) {
                    text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "");
                } else if (text.startsWith("```")) {
                    text = text.replace(/^```\s*/, "").replace(/\s*```$/, "");
                }

                const data = JSON.parse(text);
                return data;
            } catch (err) {
                lastError = err;
                console.warn(`Fallback attempt ${i + 1} failed:`, err);
                rotateGeminiKey();
            }
        }
        throw new Error("All fallback Gemini API keys failed or quota exceeded.");
    }

    function renderResults(data) {
        // Hide loading, show results
        loadingState.style.display = "none";
        resultState.style.display = "block";

        // 1. Render Markdown
        // ensure marked is loaded from CDN in the HTML
        if (typeof marked !== 'undefined') {
            markdownContent.innerHTML = marked.parse(data.summary || "No summary was generated.");
        } else {
            // basic fallback if library fails to load
            markdownContent.innerHTML = `<p>${data.summary.replace(/\\n/g, "<br>")}</p>`;
        }

        // 2. Render External Resources
        resourcesContainer.innerHTML = "";
        if (data.resources && data.resources.length > 0) {
            data.resources.forEach(resource => {
                const card = document.createElement('a');
                card.href = resource.url;
                card.target = "_blank";
                card.rel = "noopener noreferrer";
                card.className = "resource-card";

                card.innerHTML = `
                    <h4>${resource.title}</h4>
                    <p>${resource.snippet}</p>
                    <div class="resource-url">
                        <i class="fas fa-external-link-alt"></i> Open Link
                    </div>
                `;
                resourcesContainer.appendChild(card);
            });
        } else {
            resourcesContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">No specific external resources were retrieved.</p>`;
        }

        // Add subtle animation subclass
        resultState.classList.add("animate__animated", "animate__fadeInUp");
    }

    function showError(message) {
        loadingState.style.display = "none";
        errorState.style.display = "block";
        errorMsg.textContent = message;
    }
});
