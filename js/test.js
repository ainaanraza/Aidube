import { GoogleGenerativeAI } from "@google/generative-ai";
import { auth } from "./firebase.js";
import { getGeminiApiKey, rotateGeminiKey, retryOperation, showNotification, checkQuota, incrementQuota, sanitizeHTML } from "./utils.js";

const urlParams = new URLSearchParams(window.location.search);
const videoId = urlParams.get('videoId');

async function generateTest() {
  const user = auth.currentUser;
  if (!user) {
    showNotification("You must be logged in to generate a test.", "warning");
    return;
  }

  if (!await checkQuota('test')) return;

  const testContent = document.getElementById('testContent');

  // Show loading state
  testContent.innerHTML = `
    <div class="loading-spinner"></div>
    <h3>Generating questions...</h3>
    <p>Analyzing video content...</p>
  `;

  try {
    // Get title from local storage
    const lastPlayed = JSON.parse(localStorage.getItem("lastPlayedVideo") || "{}");
    const title = lastPlayed.videoId === videoId ? lastPlayed.title : "this video";

    const prompt = `Generate 3 multiple choice questions for "${title}".
    Format: JSON array. No markdown.
    [{"question": "...", "options": ["..."], "correctAnswer": 0}]`;

    const result = await retryOperation(async () => {
      // Initialize with CURRENT key
      const genAI = new GoogleGenerativeAI(getGeminiApiKey());

      try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        return await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 2000 }
        });
      } catch (err) {
        if (err.message.includes('404') || err.message.includes('503')) {
          const fallbackModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
          return await fallbackModel.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 2000 }
          });
        }
        throw err;
      }
    }, 3, 2000, rotateGeminiKey); // Pass rotation callback

    const response = await result.response;
    let text = response.text();
    // Raw Gemini response logged

    // Robust JSON extraction: find the first '[' and last ']'
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');

    if (firstBracket !== -1 && lastBracket !== -1) {
      text = text.substring(firstBracket, lastBracket + 1);
    } else {
      throw new Error("No valid JSON array found in response");
    }

    const questions = JSON.parse(text);
    renderTest(questions);
    await incrementQuota('test');

  } catch (error) {
    // Error generating test
    testContent.innerHTML = `
      <div style="color: #ef4444;">
        <h3>Error generating test</h3>
        <p>${error.message}</p>
        <button class="generate-btn" onclick="generateTest()">Try Again</button>
      </div>
    `;
  }
}


function renderTest(questions) {
  const testContent = document.getElementById('testContent');
  let html = '<div style="text-align: left; width: 100%; max-width: 600px;">';

  questions.forEach((q, index) => {
    html += `
      <div class="question-block" style="margin-bottom: 2rem;">
        <h3 style="color: #1e3a8a; margin-bottom: 1rem;">Question ${index + 1}</h3>
        <p style="font-size: 1.1rem; margin-bottom: 1rem;">${sanitizeHTML(q.question)}</p>
        <div style="display: flex; flex-direction: column; gap: 0.8rem;">
    `;

    q.options.forEach((opt, optIndex) => {
      html += `
        <label style="padding: 1rem; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 0.5rem;">
          <input type="radio" name="q${index}" value="${optIndex}"> ${sanitizeHTML(opt)}
        </label>
      `;
    });

    html += `</div></div>`;
  });

  html += `
    <button class="generate-btn" style="width: 100%; margin-top: 1rem;" onclick="submitTest()">
      Submit Answers
    </button>
  </div>`;

  testContent.innerHTML = html;

  // Store correct answers for validation
  window.correctAnswers = questions.map(q => q.correctAnswer);
}

function submitTest() {
  const correctAnswers = window.correctAnswers;
  let score = 0;

  correctAnswers.forEach((correct, index) => {
    const selected = document.querySelector(`input[name="q${index}"]:checked`);
    if (selected && parseInt(selected.value) === correct) {
      score++;
    }
  });

  showNotification(`You scored ${score} out of ${correctAnswers.length} !`, "success");
}

window.generateTest = generateTest;
window.submitTest = submitTest;
