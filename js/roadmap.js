import { GoogleGenerativeAI } from "https://cdn.jsdelivr.net/npm/@google/generative-ai/+esm";

const API_KEY = "AIzaSyDTDbXBVwlnC4uAot8ge4-RAFPYWHCjDO4";

// small helper to query single element
const $ = (sel) => document.querySelector(sel);

// Wait for DOM to be ready, then wire event listeners
document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const topic = params.get("topic");
  const topicTitleEl = $("#topicTitle");
  if (topicTitleEl) topicTitleEl.textContent = topic || "Unknown Topic";
  if (topic) populateTopics(topic);

  // Toggle the "previously known" topics container
  const knowledgeSelect = $("#knowledgeSelect");
  const topicsContainer = $("#topicsContainer");
  if (knowledgeSelect && topicsContainer) {
    knowledgeSelect.addEventListener("change", (e) => {
      topicsContainer.style.display = e.target.value === "previous" ? "block" : "none";
    });
  }

  // Attach click listener to Generate button
  const generateBtn = $("#generateBtn");
  if (generateBtn) {
    generateBtn.addEventListener("click", async () => {
      if (!topic) {
        alert("Please provide a topic in the URL (?topic=YourTopic)");
        return;
      }
      await generateRoadmap(topic);
    });
  }
});

// Fetch related subtopics dynamically using Gemini
async function fetchRelatedTopics(mainTopic) {
  try {
    const levelEl = document.getElementById("levelSelect");
    const level = levelEl ? levelEl.value : "beginner";

    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Stronger prompt to ensure relevant & capped topics
    const prompt = `List the 10 most important subtopics for learning "${mainTopic}" at a ${level} level.
Return ONLY the subtopic names, one per line, no numbering, no explanations.`;

    const result = await model.generateContent(prompt);
    const raw = (result && result.response && typeof result.response.text === "function")
      ? await result.response.text()
      : (result && result.response) ? String(result.response) : "";

    if (!raw) return [];

    // Flexible parsing: handle lists, commas, bullets
    let topics = raw
      .split(/\r?\n|,|;|-/)             
      .map(t => t.replace(/^[\s\d\.\)\-\*]+/, "").trim()) 
      .filter(t => t.length > 0);

    // Retry if Gemini gave fewer than 5
    if (topics.length < 5) {
      const strictPrompt = `Provide exactly 10 key subtopics for "${mainTopic}" at ${level} level.
Only names, one per line, no numbering, no extra text.`;
      const retry = await model.generateContent(strictPrompt);
      const retryText = (retry && retry.response && typeof retry.response.text === "function")
        ? await retry.response.text()
        : (retry && retry.response) ? String(retry.response) : "";
      topics = retryText
        .split(/\r?\n|,|;/)
        .map(t => t.replace(/^[\s\d\.\)\-\*]+/, "").trim())
        .filter(t => t.length > 0);
    }

    // Always cap at 10
    return topics.slice(0, 10);
  } catch (err) {
    console.error("fetchRelatedTopics error:", err);
    return [];
  }
}




// Populate checkboxes dynamically
async function populateTopics(mainTopic) {
  const container = document.getElementById("dynamicTopics");
  if (!container) return;

  container.innerHTML = `<div class="loading">Fetching related topics...</div>`;
  let topics = await fetchRelatedTopics(mainTopic);

  // Fallback if Gemini fails or returns empty
  if (topics.length === 0) {
    topics = ["Basics", "Core Concepts", "Applications", "Advanced Techniques"];
  }

  container.innerHTML = "";
  topics.forEach(topic => {
    const label = document.createElement("label");
    label.style.marginRight = "1rem";
    label.innerHTML = `<input type="checkbox" value="${topic}"> ${topic}`;
    container.appendChild(label);
  });
}



// Main function that generates roadmap using filters
async function generateRoadmap(topic) {
  const roadmapContainer = document.getElementById("roadmapContent");
  try {
    // Show loading UI
    roadmapContainer.innerHTML = `<div class="loading">Generating roadmap — please wait...</div>`;

    // Read filter values (safe guards if elements missing)
    const levelEl = document.getElementById("levelSelect");
    const knowledgeEl = document.getElementById("knowledgeSelect");
    const level = levelEl ? levelEl.value : "beginner";
    const knowledge = knowledgeEl ? knowledgeEl.value : "new";

    // If previously known -> collect excluded topics
    let excludedTopics = [];
    if (knowledge === "previous") {
      excludedTopics = Array.from(document.querySelectorAll("#topicsContainer input[type='checkbox']:checked"))
        .map(cb => cb.value);
    }

    // Build prompt that includes level + exclusions
    let prompt = `Create a ${level} level learning roadmap for: ${topic}.`;
    if (knowledge === "previous" && excludedTopics.length > 0) {
      prompt += ` Exclude these topics: ${excludedTopics.join(", ")}.`;
    }
    prompt += " Provide the roadmap as short ordered/bullet steps, each on a new line.";

    // Call the generative model
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const response = await result.response.text();

    // result.response.text() can be async — await it when available
    const responseText = (result && result.response && typeof result.response.text === "function")
      ? await result.response.text()
      : (result && result.response) ? String(result.response) : "";

    roadmapContainer.innerHTML = ""; // clear loading

    if (!responseText || responseText.trim() === "") {
      roadmapContainer.innerHTML = `<div class="error-message">Unable to generate roadmap. Please check your API key and network.</div>`;
      return;
    }

    // Parse into steps (strip leading bullets/numbers and empty lines)
    const steps = responseText
      .split(/\r?\n/)
      .map(s => s.replace(/^[\s\-\*\d\.\)]+/, "").trim())
      .filter(s => s !== "");

    // Build DOM
    const roadmapTree = document.createElement("div");
    roadmapTree.className = "roadmap-tree";

    steps.forEach((step, index) => {
      const isMainTopic = !step.startsWith("-");
      const mainTopic = step.split(":")[0].trim();

      const roadmapStep = document.createElement("div");
      roadmapStep.className = "roadmap-step";
      roadmapStep.style.animationDelay = `${index * 0.12}s`;
      roadmapStep.innerHTML = `
        <p>${step}</p>
        ${isMainTopic ? `<a href="index.html?search=${encodeURIComponent(mainTopic)}">
          Explore Playlist
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </a>` : ""}
      `;
      roadmapTree.appendChild(roadmapStep);
    });

    roadmapContainer.appendChild(roadmapTree);

    // Add Save button (uses saveRoadmap below)
    const saveButton = document.createElement("button");
    saveButton.className = "save-roadmap-button";
    saveButton.innerHTML = `
      Save Your Journey
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:8px">
        <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
    `;
    saveButton.onclick = () => saveRoadmap(topic, steps);
    roadmapContainer.appendChild(saveButton);

  } catch (err) {
    console.error("generateRoadmap error:", err);
    roadmapContainer.innerHTML = `<div class="error-message">Error generating roadmap. Open browser console for details.</div>`;
  }
}

// Save function (unchanged behavior)
function saveRoadmap(topic, steps) {
  const savedRoadmaps = JSON.parse(localStorage.getItem("savedRoadmaps") || "[]");
  savedRoadmaps.push({ topic, steps });
  localStorage.setItem("savedRoadmaps", JSON.stringify(savedRoadmaps));

  const notification = document.createElement("div");
  notification.className = "notification";
  notification.textContent = "Journey saved successfully!";
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = "0";
    notification.style.transform = "translateY(100px)";
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}