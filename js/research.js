import { callGeminiApi } from "./utils.js";
import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

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

    onAuthStateChanged(auth, (user) => {
        if (!user) {
            topicTitleEl.textContent = "Authentication Required";
            showError("You must be logged in to use the resource feature.");
            return;
        }

        if (!topic) {
            topicTitleEl.textContent = "Unknown Topic";
            showError("No topic was specified for research. Please go back to the dashboard and try again.");
            return;
        }

        topicTitleEl.textContent = topic;

        // Start Research Process
        runResearchEngine(topic);
    });

    async function runResearchEngine(searchTopic) {
        try {
            const data = await callGeminiApi("research", { topic: searchTopic });

            // Render the results
            renderResults(data);

        } catch (error) {
            console.error("Research Error:", error);
            showError("Failed to generate research: " + error.message);
        }
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
