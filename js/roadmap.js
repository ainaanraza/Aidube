import { GoogleGenerativeAI } from "https://cdn.jsdelivr.net/npm/@google/generative-ai/+esm";
import { auth, db } from "./firebase.js";
import { addDoc, collection, getDocs, deleteDoc }
  from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
import { showNotification, checkQuota, incrementQuota, sanitizeHTML, getGeminiApiKey, rotateGeminiKey, retryOperation } from "./utils.js";


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

  // Toggle the "previously known" topics container
  const knowledgeSelect = $("#knowledgeSelect");
  const topicsContainer = $("#topicsContainer");
  let topicsPopulated = false;

  if (knowledgeSelect && topicsContainer) {
    knowledgeSelect.addEventListener("change", (e) => {
      const isPrevious = e.target.value === "previous";
      topicsContainer.style.display = isPrevious ? "block" : "none";

      if (isPrevious && topic && !topicsPopulated) {
        populateTopics(topic);
        topicsPopulated = true;
      }
    });

    // Handle initial state if browser auto-fills the selection
    if (knowledgeSelect.value === "previous" && topic) {
      topicsContainer.style.display = "block";
      populateTopics(topic);
      topicsPopulated = true;
    }
  }

  // Attach click listener to Generate button
  const generateBtn = $("#generateBtn");
  if (generateBtn) {
    generateBtn.addEventListener("click", async () => {
      const user = auth.currentUser;
      if (!user) {
        showNotification("You must be logged in to generate a roadmap.", "warning");
        return;
      }
      if (!topic) {
        showNotification("Please provide a topic in the URL (?topic=YourTopic)", "error");
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

    const preferredModel = "gemini-3.6-flash"; // or dynamically chosen from listModels()

    // Stronger prompt to ensure relevant & capped topics
    const prompt = `List the 10 most important subtopics for learning "${mainTopic}" at a ${level} level.
Return ONLY the subtopic names, one per line, no numbering, no explanations.`;

    const result = await retryOperation(async () => {
      const genAI = new GoogleGenerativeAI(await getGeminiApiKey());
      const model = genAI.getGenerativeModel({ model: preferredModel });
      return await model.generateContent(prompt);
    }, 5, 1000, () => {
      console.warn("fetchRelatedTopics API limit hit, rotating key...");
      rotateGeminiKey();
    });

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

      const retryResult = await retryOperation(async () => {
        const genAI = new GoogleGenerativeAI(await getGeminiApiKey());
        const model = genAI.getGenerativeModel({ model: preferredModel });
        return await model.generateContent(strictPrompt);
      }, 5, 1000, () => {
        console.warn("fetchRelatedTopics retry API limit hit, rotating key...");
        rotateGeminiKey();
      });

      const retryText = (retryResult && retryResult.response && typeof retryResult.response.text === "function")
        ? await retryResult.response.text()
        : (retryResult && retryResult.response) ? String(retryResult.response) : "";
      topics = retryText
        .split(/\r?\n|,|;/)
        .map(t => t.replace(/^[\s\d\.\)\-\*]+/, "").trim())
        .filter(t => t.length > 0);
    }

    // Always cap at 10
    return topics.slice(0, 10);
  } catch (err) {
    // fetchRelatedTopics error
    return [];
  }
}


// call the models listing (v1beta) to see what model names the API currently exposes
async function listModels() {
  const apiKey = await getGeminiApiKey();
  const url = "https://generativelanguage.googleapis.com/v1beta/models?key=" + apiKey;
  const res = await fetch(url, {
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`ListModels failed: ${res.status} ${txt}`);
  }
  const json = await res.json();
  // json.models is the array of available model metadata (inspect it in console)
  // Available models logged
  return json.models || [];
}

async function pickModel(preferred = ["gemini-3.6-flash", "gemini-3.5-flash"]) {
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
    // Could not list models
    return null;
  }
}

async function populateTopics(mainTopic) {
  const container = document.getElementById("dynamicTopics");
  if (!container) return;

  container.innerHTML = `<div class="loading" style="padding: 1rem; border: none;"><i class="fas fa-sync fa-spin"></i> Identifying skill clusters...</div>`;
  let topics = await fetchRelatedTopics(mainTopic);

  if (topics.length === 0) {
    topics = ["Foundations", "Core Concepts", "Standard Practices", "Advanced Implementation"];
  }

  container.innerHTML = "";
  topics.forEach((topic, idx) => {
    const safeId = `topic-${idx}-${String(topic).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;

    const label = document.createElement("label");
    label.className = "resource-tag";
    label.style.cursor = "pointer";
    label.style.display = "flex";
    label.style.alignItems = "center";
    label.style.gap = "0.5rem";
    label.htmlFor = safeId;

    label.innerHTML = `
      <input type="checkbox" value="${sanitizeHTML(topic)}" id="${sanitizeHTML(safeId)}" style="accent-color: var(--primary);">
      <span>${sanitizeHTML(topic)}</span>
    `;

    container.appendChild(label);
  });
}



async function generateRoadmap(topic) {
  const roadmapContainer = document.getElementById("roadmapContent");
  try {
    roadmapContainer.innerHTML = `
      <div class="loading" style="padding: 4rem; border: 1px dashed var(--primary); background: var(--surface); border-radius: 24px;">
        <i class="fas fa-compass fa-spin fa-3x" style="margin-bottom: 1.5rem; color: var(--primary); display: block;"></i>
        <div style="font-weight: 700; color: var(--text); font-size: 1.25rem;">Designing Your Learning Path</div>
        <p style="color: var(--text-muted); margin-top: 0.5rem;">Analyzing millions of educational data points...</p>
      </div>`;

    // Check Quota first
    if (!await checkQuota('roadmap')) {
      roadmapContainer.innerHTML = ""; // Clear loading
      return;
    }

    const levelEl = document.getElementById("levelSelect");
    const knowledgeEl = document.getElementById("knowledgeSelect");
    const level = levelEl ? levelEl.value : "beginner";
    const knowledge = knowledgeEl ? knowledgeEl.value : "new";

    let excludedTopics = [];
    if (knowledge === "previous") {
      excludedTopics = Array.from(document.querySelectorAll("#dynamicTopics input[type='checkbox']:checked"))
        .map(cb => cb.value);
    }

    let prompt = `Create a ${level} level learning roadmap for: ${topic}.`;
    if (knowledge === "previous" && excludedTopics.length > 0) {
      prompt += ` Exclude these topics: ${excludedTopics.join(", ")}.`;
    }
    prompt += " Provide the roadmap as short ordered/bullet steps, each on a new line.";

    const result = await retryOperation(async () => {
      const genAI = new GoogleGenerativeAI(await getGeminiApiKey());
      const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });
      return await model.generateContent(prompt);
    }, 5, 1000, () => {
      console.warn("generateRoadmap API limit hit, rotating key...");
      rotateGeminiKey();
    });
    const responseText = await result.response.text();

    roadmapContainer.innerHTML = "";

    if (!responseText || responseText.trim() === "") {
      roadmapContainer.innerHTML = `<div class="error-message">Unable to generate roadmap. Please check network.</div>`;
      return;
    }

    const steps = responseText
      .split(/\r?\n/)
      .map(sanitizeText)
      .filter(s => s !== "" && !s.toLowerCase().includes("roadmap") && !s.toLowerCase().includes("learning"));

    const container = document.createElement("div");
    container.className = "roadmap-container";

    steps.forEach((step, index) => {
      const mainTopic = sanitizeText(step.split(":")[0]).replace(/^\d+\.\s*/, "").replace(/^-\s*/, "");

      const item = document.createElement("div");
      item.className = "roadmap-item animate__animated animate__fadeInUp";
      item.style.animationDelay = `${index * 0.1}s`;
      item.innerHTML = `
      <span class="roadmap-step">Milestone ${index + 1}</span>
        <h3 class="roadmap-title">${sanitizeHTML(mainTopic)}</h3>
        <p class="roadmap-desc">${sanitizeHTML(step)}</p>
        <button class="btn-primary" onclick="window.location.href='index.html?search=${encodeURIComponent(mainTopic)}'">
          <i class="fas fa-play-circle"></i> Start Learning
        </button>
    `;
      container.appendChild(item);
    });

    roadmapContainer.appendChild(container);

    const saveButton = document.createElement("button");
    saveButton.className = "btn-secondary";
    saveButton.style.marginTop = "2rem";
    saveButton.style.width = "100%";
    saveButton.style.justifyContent = "center";
    saveButton.style.padding = "1rem";
    saveButton.innerHTML = `<i class="fas fa-bookmark"></i> Save This Entire Journey`;
    saveButton.onclick = () => saveRoadmap(topic, steps);
    roadmapContainer.appendChild(saveButton);

    // Increment usage
    await incrementQuota('roadmap');

  } catch (err) {
    roadmapContainer.innerHTML = `<div class="error-message">Error generating roadmap. Please try again later.</div>`;
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
    // Cloud save roadmap failed
  }

  showNotification("Journey saved successfully!", "success");
}



function renderSavedRoadmap(topic, steps) {
  const roadmapContainer = document.getElementById("roadmapContent");
  roadmapContainer.innerHTML = "";

  const container = document.createElement("div");
  container.className = "roadmap-container";

  steps.forEach((step, index) => {
    const mainTopic = sanitizeText(step.split(":")[0]).replace(/^\d+\.\s*/, "").replace(/^-\s*/, "");
    const item = document.createElement("div");
    item.className = "roadmap-item animate__animated animate__fadeInUp";
    item.style.animationDelay = `${index * 0.1} s`;
    item.innerHTML = `
      <span class="roadmap-step">Step ${index + 1}</span>
      <h3 class="roadmap-title">${sanitizeHTML(mainTopic)}</h3>
      <p class="roadmap-desc">${sanitizeHTML(step)}</p>
      <button class="btn-primary" onclick="window.location.href='index.html?search=${encodeURIComponent(mainTopic)}'">
        <i class="fas fa-play-circle"></i> Continue Skill
      </button>
    `;
    container.appendChild(item);
  });

  roadmapContainer.appendChild(container);
}


