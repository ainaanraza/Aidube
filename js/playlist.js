import { auth, db } from "./firebase.js";
import { setDoc, doc, getDoc, deleteDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
import { getYouTubeApiKey, rotateYouTubeKey, isValidPlaylistId, retryOperation, getGeminiApiKey, rotateGeminiKey, showNotification, checkQuota, incrementQuota, sanitizeHTML, trackVideoCompletion, awardCredits } from "./utils.js";
import { GoogleGenerativeAI } from "@google/generative-ai";


const urlParams = new URLSearchParams(window.location.search);
const playlistId = urlParams.get('playlistId');
const lastVideoId = urlParams.get('videoId');

const videoPlayer = document.getElementById("videoPlayer");
const videoList = document.getElementById("videoList");

// Load YouTube Iframe API
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

let ytPlayer;

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

    const isFirstPage = pageToken === "";
    const totalResults = data.pageInfo ? data.pageInfo.totalResults : null;
    displayVideos(data.items, isFirstPage, totalResults);

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

let currentVideoIndex = 0;

function displayVideos(videos, isFirstPage = true, totalResults = null) {
  if (isFirstPage) {
    videoList.innerHTML = ""; // Clear existing
    currentVideoIndex = 0;
  }
  
  const countElement = document.getElementById("videoCount");
  if (countElement) {
    if (totalResults !== null) {
      countElement.textContent = `${totalResults} Professional Lessons`;
    } else if (isFirstPage) {
      countElement.textContent = `${videos.length} Professional Lessons`;
    }
  }

  videos.forEach((video, index) => {
    currentVideoIndex++;
    const videoId = video.snippet.resourceId.videoId;
    const videoTitle = video.snippet.title;
    const thumbnailUrl = video.snippet.thumbnails.medium?.url || video.snippet.thumbnails.default?.url || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

    const videoItem = document.createElement("div");
    videoItem.className = "video-item";
    videoItem.id = `video-${videoId}`;
    videoItem.innerHTML = `
      <div class="video-thumbnail">
        <img src="${sanitizeHTML(thumbnailUrl)}" alt="${sanitizeHTML(videoTitle)}" onerror="this.src='https://via.placeholder.com/120x90?text=No+Thumbnail'">
      </div>
      <div class="video-info">
        <div class="video-title">${sanitizeHTML(videoTitle)}</div>
        <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem;">
          <i class="fas fa-play-circle"></i> Lesson ${currentVideoIndex}
        </div>
      </div>
    `;
    videoItem.onclick = () => {
      playVideo(videoId, videoTitle);
      document.querySelectorAll(".video-item").forEach(el => el.classList.remove("active"));
      videoItem.classList.add("active");
    };
    videoList.appendChild(videoItem);

    if (isFirstPage && index === 0 && !lastVideoId) {
      playVideo(videoId, videoTitle);
      videoItem.classList.add("active");
    }

    if (lastVideoId && videoId === lastVideoId) {
      playVideo(videoId, videoTitle);
      videoItem.classList.add("active");
      videoItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

async function playVideo(videoId, videoTitle) {
  videoPlayer.innerHTML = `<div id="yt-player-container"></div>`;

  const titleEl = document.getElementById("courseTitle");
  if (titleEl) titleEl.textContent = videoTitle;
  
  populateLessonContent(videoId, videoTitle);

  // Save to last played
  localStorage.setItem("lastPlayedVideo", JSON.stringify({
    playlistId: playlistId,
    videoId: videoId,
    title: videoTitle
  }));

  // Initialize or load video into existing player
  const initPlayer = () => {
    if (ytPlayer) {
      ytPlayer.destroy();
    }
    ytPlayer = new window.YT.Player('yt-player-container', {
      height: '100%',
      width: '100%',
      videoId: videoId,
      playerVars: { 'rel': 0, 'showinfo': 0 },
      events: {
        'onStateChange': async (event) => {
          if (event.data === window.YT.PlayerState.ENDED) {
            await trackVideoCompletion(videoId, videoTitle, playlistId);

            // Check playlist completion via Firebase
            const user = auth.currentUser;
            if (user) {
              const videosSnapshot = await getDocs(collection(db, "users", user.uid, "completedVideos"));
              const completed = videosSnapshot.docs.map(doc => doc.data());
              const completedInPlaylist = completed.filter(v => v.playlistId === playlistId).length;

              const totalVideosElements = document.querySelectorAll('.video-item');
              if (totalVideosElements.length > 0 && completedInPlaylist >= totalVideosElements.length) {
                const docRef = doc(db, "users", user.uid, "completedPlaylists", playlistId);
                const docSnap = await getDoc(docRef);
                if (!docSnap.exists()) {
                  await setDoc(docRef, { completedAt: Date.now(), playlistId }, { merge: true });
                  showNotification("Course Completed! Badge Earned!", "success");
                }
              }
            }
          }
        }
      }
    });
  };

  if (window.YT && window.YT.Player) {
    initPlayer();
  } else {
    // API not ready yet, queue it. 
    // The standard callback is onYouTubeIframeAPIReady, but if multiple videos are clicked fast, handle safely:
    window.onYouTubeIframeAPIReady = initPlayer;
  }

  // Save to cloud history
  try {
    const user = auth.currentUser;
    if (user) {
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
  } catch (e) { }
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
    // console.log removed
    const response = await fetch(`/transcript/${videoId}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server returned ${response.status}`);
    }
    const data = await response.json();
    return data.transcript;
  } catch (e) {
    // console.error removed
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
    return null;
  }
}

async function fetchWikipediaContext(query) {
  try {
    let cleanQuery = query
      .replace(/\|.*/g, '')
      .replace(/-.*/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/#\w+/g, '')
      .replace(/tutorial|crash course|full course|for beginners|in \d{4}|part \d+/gi, '')
      .trim();

    if (!cleanQuery) return null;

    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&utf8=&format=json&origin=*`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (!searchData.query?.search?.length) return null;

    const bestMatchTitle = searchData.query.search[0].title;

    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(bestMatchTitle)}`;
    const summaryRes = await fetch(summaryUrl);

    if (!summaryRes.ok) return null;
    const summaryData = await summaryRes.json();

    const contentUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=false&titles=${encodeURIComponent(bestMatchTitle)}&format=json&origin=*&exsentences=15`;
    const contentRes = await fetch(contentUrl);
    const contentData = await contentRes.json();

    const pages = contentData.query?.pages;
    let extendedExtract = null;
    if (pages) {
      const pageId = Object.keys(pages)[0];
      if (pageId !== "-1") {
        extendedExtract = pages[pageId].extract;
      }
    }

    return {
      title: summaryData.title,
      summary: summaryData.extract,
      description: summaryData.description,
      thumbnail: summaryData.thumbnail?.source,
      articleUrl: summaryData.content_urls?.desktop?.page,
      extendedExtract: extendedExtract
    };
  } catch (e) {
    return null;
  }
}

async function getTopicKeywordFromYouTube(videoId, fallbackTitle) {
  const result = { keyword: fallbackTitle, description: "" };
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${getYouTubeApiKey()}`;
    const res = await fetch(url);
    if (!res.ok) return result;
    const data = await res.json();
    
    if (data.items && data.items.length > 0) {
      const snippet = data.items[0].snippet;
      result.description = snippet.description;
      
      // Look for the most relevant tag
      if (snippet.tags && snippet.tags.length > 0) {
        const ignoreList = ['tutorial', 'course', 'video', 'hindi', 'english', 'tech', 'programming', 'youtube', 'lesson', 'class', 'learn', 'beginner', 'advanced'];
        const bestTag = snippet.tags.find(tag => tag.length >= 3 && !ignoreList.some(bad => tag.toLowerCase().includes(bad)));
        if (bestTag) result.keyword = bestTag;
      } else {
        result.keyword = snippet.title;
      }
    }
  } catch(e) { }
  return result;
}

async function populateLessonContent(videoId, videoTitle) {
  const summaryEl = document.getElementById("lessonSummaryContent");
  const conceptsEl = document.getElementById("keyConceptsContent");
  const notesEl = document.getElementById("notesContent");
  const introEl = document.getElementById("courseIntro");

  if (summaryEl) summaryEl.innerHTML = `<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Finding related article...</div>`;
  if (conceptsEl) conceptsEl.innerHTML = `<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Analyzing concepts...</div>`;
  if (notesEl) notesEl.innerHTML = `<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Compiling notes...</div>`;
  if (introEl) introEl.textContent = "Loading description...";

  try {
    // Find the absolute best keyword and fetch description from youtube
    const ytData = await getTopicKeywordFromYouTube(videoId, videoTitle);
    const optimizedTopic = ytData.keyword;
    
    // Inject the real YouTube description right away
    if (introEl) {
      if (ytData.description && ytData.description.trim() !== "") {
        introEl.innerHTML = `
          <div id="descText" style="white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; font-size: 0.95rem; color: var(--text-muted); line-height: 1.6;">${sanitizeHTML(ytData.description)}</div>
          <a href="#" id="seeDescBtn" style="color: var(--primary); font-size: 0.85rem; text-decoration: none; display: inline-block; margin-top: 0.5rem; font-weight: 600;">See Description</a>
        `;
        const seeDescBtn = document.getElementById('seeDescBtn');
        const descText = document.getElementById('descText');
        seeDescBtn.addEventListener('click', (e) => {
          e.preventDefault();
          if (descText.style.webkitLineClamp === '3') {
            descText.style.webkitLineClamp = 'unset';
            e.target.textContent = 'Hide Description';
          } else {
            descText.style.webkitLineClamp = '3';
            e.target.textContent = 'See Description';
          }
        });
      } else {
        introEl.textContent = "No description available for this video.";
      }
    }
    
    // Attempt Wikipedia fetch with optimized keyword
    let wikiData = await fetchWikipediaContext(optimizedTopic);
    
    // If that fails, fallback to the original video title just in case
    if (!wikiData && optimizedTopic !== videoTitle) {
      wikiData = await fetchWikipediaContext(videoTitle);
    }

    if (wikiData && wikiData.summary) {
      if (summaryEl) {
        summaryEl.innerHTML = `
          <p><strong>Topic: ${wikiData.title}</strong> ${wikiData.description ? `(${wikiData.description})` : ''}</p>
          <p style="margin-top: 1rem;">${wikiData.summary.replace(/\n/g, '<br>')}</p>
          <a href="${wikiData.articleUrl}" target="_blank" style="display: inline-block; margin-top: 1rem; color: var(--primary); font-size: 0.85rem; text-decoration: none;"><i class="fas fa-external-link-alt"></i> Read full Wikipedia Article</a>
        `;
      }

      if (conceptsEl) {
        const words = wikiData.summary.split(/\s+/);
        const entities = new Set();
        words.forEach(word => {
          const cleanWord = word.replace(/[.,()"']/g, '');
          if (cleanWord.length > 3 && /^[A-Z]/.test(cleanWord)) entities.add(cleanWord);
        });
        wikiData.title.split(/\s+/).forEach(w => { if (w.length > 3) entities.add(w); });

        const tagsArray = Array.from(entities).slice(0, 10);
        if (tagsArray.length > 0) {
          const tagsHTML = tagsArray.map(tag => `<span class="concept-tag">${sanitizeHTML(tag)}</span>`).join('');
          conceptsEl.innerHTML = `<div class="concept-tags-container">${tagsHTML}</div>`;
        } else {
          conceptsEl.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">Broad topic inferred: ${sanitizeHTML(wikiData.title)}</p>`;
        }
      }

      if (notesEl) {
        if (wikiData.extendedExtract) {
          let cleanHTML = wikiData.extendedExtract.replace(/class=".*?"/g, '').replace(/id=".*?"/g, '');
          notesEl.innerHTML = `<div class="transcript-notes">${cleanHTML}</div>`;
        } else {
          notesEl.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">Detailed notes mapped to this topic could not be found.</p>`;
        }
      }
    } else {
      if (summaryEl) summaryEl.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">No direct encyclopedia mapping found for "${sanitizeHTML(videoTitle)}".</p>`;
      if (conceptsEl) conceptsEl.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">Concept analysis relies on contextual matching.</p>`;
      if (notesEl) notesEl.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">Watch the core video material for this lesson's details.</p>`;
    }
  } catch (e) {
    if (summaryEl) summaryEl.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">Content unavailable.</p>`;
    if (conceptsEl) conceptsEl.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">Content unavailable.</p>`;
    if (notesEl) notesEl.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">Content unavailable.</p>`;
  }
}


async function generateUsingGemini(prompt, opts = {}) {
  return await retryOperation(async () => {
    const genAI = new GoogleGenerativeAI(await getGeminiApiKey());

    try {
      // Try the newer model first (matching test.js behavior)
      const modelName = opts.model || 'gemini-3.6-flash';
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
        // console.warn removed
        const fallbackModelName = 'gemini-3.5-flash';
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

        // Helper to wrap text manually if it exceeds line width
        // This is complex for inline rendering. 
        // Simplified approach: Render line by line using simple text logic won't wrap correctly inline.
        // Better approach for PDF: use splitTextToSize for the whole line if not bold, 
        // but for mixed styles, we need to calculate widths.

        // FALLBACK FOR ROBUSTNESS: 
        // If the line is long, just print it normally. 
        // If it's short headers/labels, bold works well.
        // For this implementation, we will apply bold to the whole segment and just wrap.
        // Note: This simple loop doesn't handle wrapping of mixed flows perfectly.

        // Let's rely on standard splitTextToSize for the segment, but update X.
        // Actually, properly mixing styles in jsPDF requires advanced coordinates.
        // Simplified: If the *whole line* looks like a key-value pair "Key: Value", bold the Key.
        // Or just print the segments.

        // We'll just write the text. If it overflows, it might look messy with this simple logic.
        // Let's stick to a simpler implementation:
        // If a line contains **, just remove ** and make the WHOLE line bold if it looks like a header/key,
        // OR just print it as normal text but strip the **.
        // The USER ASKED for bold headings. The Header parsing above handles # Headers.
        // But usually "1. **Main Argument**" needs bolding.

        // REVISED STRATEGY for bold parts:
        // Just print the text plain for complex lines to avoid overlap, 
        // BUT if the specific segment is short, print it.

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
  const user = auth.currentUser;
  if (!user) {
    showNotification(`You must be logged in to generate ${type === 'notes' ? 'detailed notes' : 'a summary'}.`, "warning");
    return;
  }

  // Check Quota
  if (!await checkQuota('notes')) return;

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
      // console.log removed
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
          
          Create comprehensive, detailed study notes IN ENGLISH including:
          1.  **Executive Summary**
          2.  **Key Concepts**
          3.  **Core Definitions**
          4.  **Examples**
          5.  **Practice Questions**
          
          Please use Markdown formatting for headings (e.g. # Topic, ## Subtopic) and bold text (e.g. **important**).
          ENSURE ALL CONTENT IS GENERATED IN ENGLISH, even if the source text is in another language.
          
          ${sourceContext}:
          ${transcript}`;
      title = 'Complete Notes';
    } else if (type === 'summary') {
      prompt = `You are an expert summarizer. ${baseInstruction}
          
          Create a detailed, comprehensive summary IN ENGLISH including:
          1.  **Main Argument**
          2.  **Key Insights**
          3.  **Detailed Breakdown**
          4.  **Conclusion**
          
          Please use Markdown formatting for headings (e.g. # Topic, ## Subtopic) and bold text (e.g. **important**).
          ENSURE ALL CONTENT IS GENERATED IN ENGLISH, even if the source text is in another language.
          
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

    // Increment quota on success
    await incrementQuota('notes');
  } catch (e) {
    showNotification('Document generation failed: ' + (e.message || e), "error");
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

  const btnAskAi = document.getElementById('askAiBtn');

  if (btnNotes) btnNotes.addEventListener('click', () => handleGenerateDocument('notes', btnNotes));
  if (btnSummary) btnSummary.addEventListener('click', () => handleGenerateDocument('summary', btnSummary));

  if (btnAskAi) {
    btnAskAi.addEventListener('click', () => {
      showNotification('Ask Aidube functionality is coming soon!', 'info');
    });
  }

  if (btnTest) {
    btnTest.addEventListener('click', async () => {
      const user = auth.currentUser;
      if (!user) {
        showNotification("You must be logged in to take a test.", "warning");
        return;
      }
      if (!await checkQuota('test')) return;
      try {
        const iframe = videoPlayer.querySelector('iframe');
        if (!iframe) return showNotification('No video loaded', "error");
        const src = iframe.src || '';
        const match = src.match(/embed\/([a-zA-Z0-9_-]{11,})/);
        const videoId = match ? match[1] : null;
        if (!videoId) return showNotification('Could not determine video id', "error");

        // Try to fetch transcript and store in sessionStorage for new page
        const transcript = await fetchTranscript(videoId) || `No transcript available for https://www.youtube.com/watch?v=${videoId}`;
        sessionStorage.setItem('aidube_video_transcript', transcript);
        sessionStorage.setItem('aidube_video_id', videoId);
        // Open test generator page
        window.location.href = `test.html?videoId=${encodeURIComponent(videoId)}`;
      } catch (e) {
        // Test generation error
        showNotification('Could not start test generation: ' + e.message, "error");
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

  if (headerContainer.querySelector(".save-playlist-btn")) return;

  const btn = document.createElement("button");
  btn.className = "save-playlist-btn action-btn";
  btn.style.marginTop = "0.5rem";
  btn.style.width = "auto";
  btn.style.padding = "0.5rem 1rem";
  btn.style.fontSize = "0.825rem";
  btn.innerHTML = `<i class="fas fa-bookmark"></i> Save to Dashboard`;

  const localPlaylists = JSON.parse(localStorage.getItem("savedPlaylists") || "[]");
  if (localPlaylists.some(p => p.id === playlistId)) {
    btn.innerHTML = `<i class="fas fa-check"></i> Saved`;
    btn.classList.add("saved-state");
    btn.style.background = "var(--bg)";
    btn.style.color = "var(--text-muted)";
    btn.style.borderColor = "var(--border)";
    btn.disabled = true;
  }

  btn.onclick = () => savePlaylistToDashboard(btn);
  headerContainer.appendChild(btn);
}

async function savePlaylistToDashboard(btnElement) {
  if (!playlistId || !isValidPlaylistId(playlistId)) {
    showNotification("Invalid playlist ID", "error");
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
    showNotification(`Playlist "${sanitizeHTML(title)}" saved!`, "success");

  } catch (error) {
    // Error saving playlist
    showNotification("Failed to save playlist.", "error");
  }
}



// Call fetch details on load
fetchPlaylistDetails();
