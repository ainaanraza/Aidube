import { auth, db } from "./firebase.js";
import { setDoc, doc } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const apiKey = "AIzaSyB8qZ_7Z7miBrUeo2cRDE6aPwyhe5TVCo8";
const urlParams = new URLSearchParams(window.location.search);
const playlistId = urlParams.get('playlistId');
const lastVideoId = urlParams.get('videoId');

const videoPlayer = document.getElementById("videoPlayer");
const videoList = document.getElementById("videoList");

// Function to validate playlist ID
function isValidPlaylistId(id) {
  // Playlist IDs typically start with 'PL' and are longer than 11 characters
  // Video IDs are exactly 11 characters
  return id && id.length > 11 && (id.startsWith('PL') || id.startsWith('UU') || id.startsWith('FL'));
}

async function loadPlaylist(pageToken = "") {
  try {
    if (!playlistId) {
      throw new Error("Playlist ID is missing in the URL parameters.");
    }

    // Validate playlist ID
    if (!isValidPlaylistId(playlistId)) {
      throw new Error(`Invalid playlist ID: "${playlistId}". This appears to be a video ID, not a playlist ID.`);
    }

    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&key=${apiKey}&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ""}`;
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
    }

  } catch (error) {
    console.error("Error loading playlist:", error);
    videoList.innerHTML = `
      <div class="error-message">
        <h3>Error loading playlist</h3>
        <p>${error.message}</p>
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
      await setDoc(doc(db, "users", user.uid, "history", videoId), {
        title: videoTitle,
        id: videoId,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        playedAt: Date.now(),
        playlistId: playlistId
      }, { merge: true });
    }
  } catch (e) {
    console.warn("Cloud history write failed:", e);
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