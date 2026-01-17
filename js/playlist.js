import { auth, db } from "./firebase.js";
import { setDoc, doc, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
import { getYouTubeApiKey, rotateYouTubeKey, isValidPlaylistId, retryOperation, getGeminiApiKey, rotateGeminiKey } from "./utils.js";
import { GoogleGenerativeAI } from "@google/generative-ai";


const urlParams = new URLSearchParams(window.location.search);
const playlistId = urlParams.get('playlistId');
const lastVideoId = urlParams.get('videoId');

const videoPlayer = document.getElementById("videoPlayer");
const videoList = document.getElementById("videoList");

// Current playlist title state
let currentPlaylistTitle = "Unknown Playlist";

async function loadPlaylist(pageToken = "") {
  try {
    if (!playlistId) {
      throw new Error("Playlist ID is missing in the URL parameters.");
    }

    // Validate playlist ID
    if (!isValidPlaylistId(playlistId)) {
      throw new Error(`Invalid playlist ID: "${playlistId}". This appears to be a video ID, not a playlist ID.`);
    }

    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&key=${getYouTubeApiKey()}&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`YouTube API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      if (videoList.innerHTML.trim() === "") {
        videoList.innerHTML = "<p>No videos found in this playlist.</p>";
      }
      return;
    }

    displayVideos(data.items);

    if (data.nextPageToken) {
      await loadPlaylist(data.nextPageToken);
    } else {
      // All videos loaded
    }

  } catch (error) {
    // Error loading playlist
    videoList.innerHTML = `
      <div class="error-message">
        <h3>Error loading playlist</h3>
        setTimeout(() => window.location.href = "index.html", 5000);

        <p><a href="index.html">Return to Home</a></p>
      </div>
    `;
  }
}

function displayVideos(videos) {
  videos.forEach((video, index) => {
    const videoId = video.snippet.resourceId.videoId;
    const videoTitle = video.snippet.title;
    const thumbnailUrl = video.snippet.thumbnails.default?.url || `https://i.ytimg.com/vi/${videoId}/default.jpg`;

    const videoItem = document.createElement("div");
    videoItem.className = "video-item";
    videoItem.innerHTML = `
      <img src="${thumbnailUrl}" alt="${videoTitle}" onerror="this.src='https://via.placeholder.com/120x90?text=No+Thumbnail'">
      <p>${videoTitle}</p>
    `;
    videoItem.onclick = () => playVideo(videoId, videoTitle);
    videoList.appendChild(videoItem);

    // Auto-play first video if no specific video is requested
    if (index === 0 && !lastVideoId) {
      playVideo(videoId, videoTitle);
    }

    // Auto-play the requested video
    if (lastVideoId && videoId === lastVideoId) {
      playVideo(videoId, videoTitle);
    }
  });
}

async function playVideo(videoId, videoTitle) {
  videoPlayer.innerHTML = `
    <iframe 
      width="100%" 
      height="100%" 
      src="https://www.youtube-nocookie.com/embed/${videoId}?rel=0&showinfo=0" 
      frameborder="0" 
      allow="encrypted-media" 
      allowfullscreen>
    </iframe>
  `;

  // Save to last played
  localStorage.setItem("lastPlayedVideo", JSON.stringify({
    playlistId: playlistId,
    videoId: videoId,
    title: videoTitle
  }));

  // Save to cloud history
  try {
    const user = auth.currentUser;
    if (user) {
      // Skip saving individual videos to history
      if (videoId.length > 11 && (videoId.startsWith("PL") || videoId.startsWith("UU") || videoId.startsWith("FL"))) {
        await setDoc(doc(db, "users", user.uid, "history", videoId), {
          title: videoTitle,
          id: videoId,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          playedAt: Date.now(),
          playlistId: playlistId
        }, { merge: true });
      }
    }

  } catch (e) {
    // Cloud history write failed
  }
}

// Add CSS for error message
const style = document.createElement('style');
style.textContent = `
  .error-message {
    text-align: center;
    padding: 2rem;
    background: #fee;
    border: 1px solid #fcc;
    border-radius: 8px;
    margin: 1rem 0;
  }
  .error-message h3 {
    color: #c00;
    margin-bottom: 1rem;
  }
  .error-message a {
    color: #3b82f6;
    text-decoration: none;
  }
  .error-message a:hover {
    text-decoration: underline;
  }
`;
document.head.appendChild(style);

// Initialize
loadPlaylist();

window.loadPlaylist = loadPlaylist;
window.playVideo = playVideo;

// ----- New: Notes / Summary / Test helpers -----

// Provide your Generative API key here or the code will prompt for it when needed
// Gemini API key is managed via utils.js

async function fetchTranscript(videoId) {
  try {
    console.log(`Fetching transcript from local backend for ${videoId}...`);
    const response = await fetch(`http://localhost:5000/transcript/${videoId}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server returned ${response.status}`);
    }
    const data = await response.json();
    return data.transcript;
  } catch (e) {
    console.error("Local transcript fetch failed:", e);
    return null;
  }
}

async function fetchVideoDetails(videoId) {
  try {
    return await retryOperation(async () => {
      const key = getYouTubeApiKey();
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${key}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Video details fetch failed');
      const data = await res.json();
      if (!data.items || data.items.length === 0) throw new Error('Video not found');

      const snippet = data.items[0].snippet;
      return `Title: ${snippet.title}\n\nDescription:\n${snippet.description}`;
    }, 3, 1000, rotateYouTubeKey);
  } catch (e) {
    console.warn('Video details fetch failed:', e);
    return null;
  }
}


async function generateUsingGemini(prompt, opts = {}) {
  return await retryOperation(async () => {
    const genAI = new GoogleGenerativeAI(getGeminiApiKey());

    try {
      // Try the newer model first (matching test.js behavior)
      const modelName = opts.model || 'gemini-2.5-flash';
      const model = genAI.getGenerativeModel({ model: modelName });

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: opts.temperature || 0.2,
          maxOutputTokens: opts.maxTokens || 1200,
        }
      });
      const response = await result.response;
      return response.text();
    } catch (err) {
      // Fallback for 404 (model not found) or 503 (service unavailable)
      if (err.message.includes('404') || err.message.includes('503')) {
        console.warn('Primary model failed, using fallback:', err.message);
        const fallbackModelName = 'gemini-1.5-flash';
        const fallbackModel = genAI.getGenerativeModel({ model: fallbackModelName });
        const result = await fallbackModel.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: opts.temperature || 0.2,
            maxOutputTokens: opts.maxTokens || 8192,
          }
        });
        const response = await result.response;
        return response.text();
      }
      throw err;
    }
  }, 3, 1000, rotateGeminiKey);
}

function createStyledPdf(title, text, shortName = 'notes') {
  try {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) throw new Error('jsPDF not found');
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 40;
    const maxLineWidth = pageWidth - (margin * 2);

    let cursorY = margin + 20;

    // WATERMARK
    doc.setTextColor(230, 230, 230);
    doc.setFontSize(50);
    doc.text('Aidube', pageWidth / 2, pageHeight / 2, {
      align: 'center',
      baseline: 'middle',
      angle: 45
    });

    // DOCUMENT TITLE
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text(title || 'Notes', margin, cursorY);
    cursorY += 40;

    // Reset for content
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);

    // Parse simple markdown
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();

      // Check for page break necessity
      if (cursorY > pageHeight - margin) {
        doc.addPage();
        cursorY = margin;
      }

      if (!line) {
        cursorY += 10; // Paragraph spacing
        continue;
      }

      // 1. HEADERS (###, ##, #)
      if (line.startsWith('#')) {
        let level = 0;
        while (line.startsWith('#')) {
          level++;
          line = line.substring(1);
        }
        line = line.trim();

        doc.setFont("helvetica", "bold");
        if (level === 1) {
          doc.setFontSize(18);
          cursorY += 10;
        } else if (level === 2) {
          doc.setFontSize(15);
          cursorY += 8;
        } else {
          doc.setFontSize(13);
          cursorY += 6;
        }

        doc.text(line, margin, cursorY);
        cursorY += (level === 1 ? 25 : 20);

        // Reset to body text
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        continue;
      }

      // 2. BOLD TEXT (**text**)
      // Simple parser: assumes one bold section per line or splits by bold syntax
      // We'll split the line by ** to handle inline bolding
      const parts = line.split('**');
      let currentX = margin;

      // Identify if it's a bullet point
      if (line.startsWith('- ') || line.startsWith('* ')) {
        parts[0] = parts[0].replace(/^[-*]\s+/, '');
        // Draw bullet
        doc.text('\u2022', margin - 15, cursorY);
      }

      for (let j = 0; j < parts.length; j++) {
        // Even indexes are normal, odd are bold (if input is **bold** text)
        // Example: "Normal " "Bold" " Normal"

        const segment = parts[j];
        if (!segment) continue;

        if (j % 2 === 1) {
          doc.setFont("helvetica", "bold");
        } else {
          doc.setFont("helvetica", "normal");
        }

        const segmentLines = doc.splitTextToSize(segment, maxLineWidth - (currentX - margin));

        // If it's just one line, we print inline
        if (segmentLines.length === 1) {
          doc.text(segment, currentX, cursorY);
          currentX += doc.getTextWidth(segment);
        } else {
          // Multiline - just formatting the whole block potentially
          // Check if we are at start of line
          if (currentX === margin) {
            doc.text(segmentLines, margin, cursorY);
            cursorY += (segmentLines.length * 14);
          } else {
            // Push to next line if doesn't fit
            cursorY += 14;
            currentX = margin;
            const newLines = doc.splitTextToSize(segment, maxLineWidth);
            doc.text(newLines, margin, cursorY);
            cursorY += (newLines.length * 14);
          }
        }
      }

      cursorY += 15; // line height
    }

    const filename = `${shortName.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
    doc.save(filename);
  } catch (e) {
    alert('PDF creation failed: ' + e.message);
  }
}

async function handleGenerateDocument(type, btnElement) {
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.dataset.originalText = btnElement.innerHTML;
    btnElement.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Generating...`;
  }

  try {
    // Determine current playing video's ID from iframe src
    const iframe = videoPlayer.querySelector('iframe');
    if (!iframe) throw new Error('No video loaded');
    const src = iframe.src || '';
    const match = src.match(/embed\/([a-zA-Z0-9_-]{11,})/);
    const videoId = match ? match[1] : null;
    if (!videoId) throw new Error('Could not determine video id');

    // Try to fetch transcript first
    let transcript = await fetchTranscript(videoId);
    let sourceContext = "TRANSCRIPT";

    if (!transcript) {
      console.log('Transcript fetch failed, falling back to video metadata...');
      const metadata = await fetchVideoDetails(videoId);
      if (metadata) {
        transcript = metadata;
        sourceContext = "VIDEO METADATA (Title & Description)";
      } else {
        transcript = `Video ID: ${videoId}. (No transcript or metadata available).`;
        sourceContext = "NO DATA";
      }
    }

    let prompt = '';
    let title = '';
    const baseInstruction = sourceContext.includes("METADATA")
      ? "I could not retrieve the full transcript. Please generate the best possible content based on the following Video Title and Description."
      : "Based on the following video transcript:";

    if (type === 'notes') {
      prompt = `You are an expert academic tutor. ${baseInstruction}
          
          Create comprehensive, detailed study notes including:
          1.  **Executive Summary**
          2.  **Key Concepts**
          3.  **Core Definitions**
          4.  **Examples**
          5.  **Practice Questions**
          
          Please use Markdown formatting for headings (e.g. # Topic, ## Subtopic) and bold text (e.g. **important**).
          
          ${sourceContext}:
          ${transcript}`;
      title = 'Complete Notes';
    } else if (type === 'summary') {
      prompt = `You are an expert summarizer. ${baseInstruction}
          
          Create a detailed, comprehensive summary including:
          1.  **Main Argument**
          2.  **Key Insights**
          3.  **Detailed Breakdown**
          4.  **Conclusion**
          
          Please use Markdown formatting for headings (e.g. # Topic, ## Subtopic) and bold text (e.g. **important**).
          
          ${sourceContext}:
          ${transcript}`;
      title = 'Summary';
    } else {
      throw new Error('Unknown document type');
    }

    // Call Gemini / generative API with higher limit
    const result = await generateUsingGemini(prompt, { maxTokens: 8192 });

    // Create PDF
    createStyledPdf(`${title}`, result, `${type}_${videoId}`);
  } catch (e) {
    alert('Document generation failed: ' + (e.message || e));
  } finally {
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.innerHTML = btnElement.dataset.originalText;
    }
  }
}

// Wire up UI buttons (if present)
document.addEventListener('DOMContentLoaded', () => {
  const btnNotes = document.getElementById('notesBtn');
  const btnSummary = document.getElementById('summaryBtn');
  const btnTest = document.getElementById('testBtn');

  if (btnNotes) btnNotes.addEventListener('click', () => handleGenerateDocument('notes', btnNotes));
  if (btnSummary) btnSummary.addEventListener('click', () => handleGenerateDocument('summary', btnSummary));

  if (btnTest) {
    btnTest.addEventListener('click', async () => {
      try {
        const iframe = videoPlayer.querySelector('iframe');
        if (!iframe) return alert('No video loaded');
        const src = iframe.src || '';
        const match = src.match(/embed\/([a-zA-Z0-9_-]{11,})/);
        const videoId = match ? match[1] : null;
        if (!videoId) return alert('Could not determine video id');

        // Try to fetch transcript and store in sessionStorage for new page
        const transcript = await fetchTranscript(videoId) || `No transcript available for https://www.youtube.com/watch?v=${videoId}`;
        sessionStorage.setItem('aidube_video_transcript', transcript);
        sessionStorage.setItem('aidube_video_id', videoId);
        // Open test generator page
        window.location.href = `test.html?videoId=${encodeURIComponent(videoId)}`;
      } catch (e) {
        // Test generation error
        alert('Could not start test generation: ' + e.message);
      }
    });
  }
});

// ----- End of new helpers -----

// ----- Save Playlist Feature -----

async function fetchPlaylistDetails() {
  if (!playlistId || !isValidPlaylistId(playlistId)) return;

  try {
    const data = await retryOperation(async () => {
      // We only need snippet.title
      const url = `https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${playlistId}&key=${getYouTubeApiKey()}`;
      const res = await fetch(url);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(`Playlist details fetch failed: ${res.status} - ${errorData.error?.message || res.statusText}`);
      }
      return await res.json();
    }, 3, 1000, rotateYouTubeKey);

    if (data.items && data.items.length > 0) {
      currentPlaylistTitle = data.items[0].snippet.title;
      // Update header if exists, or we can just rely on the variable for saving
      const headerTitle = document.querySelector(".playlist-header h2");
      if (headerTitle) {
        headerTitle.textContent = currentPlaylistTitle;
        // Inject save button next to it or in the header container
        injectSaveButton();
      }
    }
  } catch (e) {
    // Could not fetch playlist details
  }
}

function injectSaveButton() {
  const headerContainer = document.querySelector(".playlist-header");
  if (!headerContainer) return;

  // Check if button already exists
  if (headerContainer.querySelector(".save-playlist-btn")) return;

  const btn = document.createElement("button");
  btn.className = "save-playlist-btn action-btn"; // reuse action-btn class for style
  btn.style.marginLeft = "1rem";
  btn.style.display = "inline-flex";
  btn.style.alignItems = "center";
  btn.style.fontSize = "0.9rem";
  btn.innerHTML = `<i class="fas fa-bookmark"></i> Save Playlist`;

  // Check if already saved to change state initially
  const localPlaylists = JSON.parse(localStorage.getItem("savedPlaylists") || "[]");
  if (localPlaylists.some(p => p.id === playlistId)) {
    btn.innerHTML = `<i class="fas fa-check"></i> Saved`;
    btn.disabled = true;
    btn.style.opacity = "0.7";
  }

  btn.onclick = () => savePlaylistToDashboard(btn);

  // Append to h2 or container? The header has an h2. Let's append to header container.
  // We might want to make the header a flex container if it isn't
  headerContainer.style.display = "flex";
  headerContainer.style.alignItems = "center";
  headerContainer.style.justifyContent = "space-between";

  headerContainer.appendChild(btn);
}

async function savePlaylistToDashboard(btnElement) {
  if (!playlistId || !isValidPlaylistId(playlistId)) {
    alert("Invalid playlist ID");
    return;
  }

  try {
    const title = currentPlaylistTitle || "Unknown Playlist";

    // 1. Local Storage
    const playlists = JSON.parse(localStorage.getItem("savedPlaylists") || "[]");
    if (!playlists.some(p => p.id === playlistId)) {
      playlists.push({ title, id: playlistId, savedAt: Date.now() });
      localStorage.setItem("savedPlaylists", JSON.stringify(playlists));
    }

    // 2. Firestore
    const user = auth.currentUser;
    if (user) {
      await setDoc(doc(db, "users", user.uid, "playlists", playlistId), {
        title,
        id: playlistId,
        savedAt: Date.now()
      }, { merge: true });
    }

    // UI Feedback
    if (btnElement) {
      btnElement.innerHTML = `<i class="fas fa-check"></i> Saved`;
      btnElement.disabled = true;
      btnElement.style.opacity = "0.7";
    }

    // Use the existing snackbar/notification style if available, or alert
    // The existing code has a style for .error-message but maybe not a generic notification.
    // I'll create a simple one or reuse if I see one reference. 
    // I saw showNotification in index.js but not exported. I'll make a local one.
    showLocalNotification(`Playlist "${title}" saved!`);

  } catch (error) {
    // Error saving playlist
    alert("Failed to save playlist. See console.");
  }
}

function showLocalNotification(msg) {
  const div = document.createElement("div");
  div.style.position = "fixed";
  div.style.bottom = "20px";
  div.style.right = "20px";
  div.style.background = "#10b981";
  div.style.color = "white";
  div.style.padding = "10px 20px";
  div.style.borderRadius = "8px";
  div.style.boxShadow = "0 2px 10px rgba(0,0,0,0.1)";
  div.style.zIndex = "9999";
  div.innerHTML = `<i class="fas fa-check-circle"></i> ${msg}`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// Call fetch details on load
fetchPlaylistDetails();
