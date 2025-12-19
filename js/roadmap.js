import { GoogleGenerativeAI } from "https://cdn.jsdelivr.net/npm/@google/generative-ai/+esm";
import { auth, db } from "./firebase.js";
import { addDoc, collection, getDocs, deleteDoc } 
  from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const API_KEY = "AIzaSyBAymnNctjlkQG4HaYj4sAv3H0VE9g6hgA";

// small helper to query single element
const $ = (sel) => document.querySelector(sel);

// sanitise/remove Markdown emphasis/backticks and stray asterisks
function sanitizeText(s) {
  if (!s) return "";
  // remove leading bullets/numbers, then remove markdown markers anywhere
  return s
    .replace(/^[\s\-\*\d\.\)]+/, "")   // strip leading bullets/numbers/asterisks
    .replace(/[`*_]{1,}/g, "")         // remove `, *, _, **, __ etc.
    .trim();
}


// Wait for DOM to be ready, then wire event listeners
document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const topic = params.get("topic");
  const topicTitleEl = document.querySelector("#topicTitle");
  if (topicTitleEl) topicTitleEl.textContent = topic || "Unknown Topic";

  const savedRoadmaps = JSON.parse(localStorage.getItem("savedRoadmaps") || "[]");
  const existing = savedRoadmaps.find(r => r.topic === topic);
  if (existing && existing.steps?.length) {
    renderSavedRoadmap(existing.topic, existing.steps);
    return; // stop here — don’t re-generate
  }

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
    const preferredModel = "gemini-2.5-flash"; // or dynamically chosen from listModels()
const model = genAI.getGenerativeModel({ model: preferredModel });


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
      .map(t => t.replace(/^[\s\d\.\)\-\*]+/, "").replace(/[`*_]{1,}/g, "").trim()) 
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


// call the models listing (v1beta) to see what model names the API currently exposes
async function listModels() {
  const url = "https://generativelanguage.googleapis.com/v1beta/models?key=" + API_KEY;
  const res = await fetch(url, {
    headers: { "x-goog-api-key": API_KEY, "Content-Type": "application/json" }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`ListModels failed: ${res.status} ${txt}`);
  }
  const json = await res.json();
  // json.models is the array of available model metadata (inspect it in console)
  console.log("Available models:", json.models);
  return json.models || [];
}

async function pickModel(preferred = ["gemini-2.5-flash","gemini-flash-latest","gemini-2.5-flash-lite"]) {
  try {
    const models = await listModels();
    // model entries vary, but each has a 'name' or 'model' field; be flexible:
    const names = models.map(m => m.name || m.model || m.modelId || "").filter(Boolean);
    for (const p of preferred) {
      const found = names.find(n => n.includes(p));
      if (found) return found;
    }
    // fallback: first model that supports generateContent (inspect model metadata)
    return names[0] || null;
  } catch (e) {
    console.warn("Could not list models:", e);
    return null;
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
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = topic;
    label.appendChild(input);
    label.appendChild(document.createTextNode(" " + topic));
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
    const preferredModel = "gemini-2.5-flash"; // or dynamically chosen from listModels()
const model = genAI.getGenerativeModel({ model: preferredModel });
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
  .map(sanitizeText)
  .filter(s => s !== "");


    // Build DOM
    const roadmapTree = document.createElement("div");
    roadmapTree.className = "roadmap-tree";

    steps.forEach((step, index) => {
      const isMainTopic = !step.startsWith("-");
      const mainTopic = sanitizeText(step.split(":")[0]);

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

// Save function 
async function saveRoadmap(topic, steps) {
  let savedRoadmaps = JSON.parse(localStorage.getItem("savedRoadmaps") || "[]");

  //  Check if topic already exists
  const existingIndex = savedRoadmaps.findIndex(r => r.topic === topic);
  if (existingIndex !== -1) {
    savedRoadmaps[existingIndex] = { topic, steps }; // update
  } else {
    savedRoadmaps.push({ topic, steps }); // new
  }

  localStorage.setItem("savedRoadmaps", JSON.stringify(savedRoadmaps));

  //  Cloud save (avoid duplicates)
  try {
    const user = auth.currentUser;
    if (user) {
      const q = await getDocs(collection(db, "users", user.uid, "roadmaps"));
      const duplicate = q.docs.find(doc => doc.data().topic === topic);
      if (!duplicate) {
        await addDoc(collection(db, "users", user.uid, "roadmaps"), {
          topic, steps, savedAt: Date.now()
        });
      }
    }
  } catch (e) {
    console.warn("Cloud save roadmap failed:", e);
  }

  const notification = document.createElement("div");
  notification.className = "notification";
  notification.textContent = "Journey saved successfully!";
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}



function renderSavedRoadmap(topic, steps) {
  const roadmapContainer = document.getElementById("roadmapContent");
  roadmapContainer.innerHTML = "";

  const roadmapTree = document.createElement("div");
  roadmapTree.className = "roadmap-tree";

  steps.forEach((step, index) => {
    const roadmapStep = document.createElement("div");
    roadmapStep.className = "roadmap-step";
    roadmapStep.style.animationDelay = `${index * 0.1}s`;
    roadmapStep.innerHTML = `
      <p>${step}</p>
      <a href="index.html?search=${encodeURIComponent(step.split(":")[0])}">
        Explore Playlist
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </a>
    `;
    roadmapTree.appendChild(roadmapStep);
  });

  roadmapContainer.appendChild(roadmapTree);
}
