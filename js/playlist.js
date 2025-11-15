const apiKey = "AIzaSyB8qZ_7Z7miBrUeo2cRDE6aPwyhe5TVCo8";
const urlParams = new URLSearchParams(window.location.search);
const playlistId = urlParams.get('playlistId');
const lastVideoId = urlParams.get('videoId');

const videoPlayer = document.getElementById("videoPlayer");
const videoList = document.getElementById("videoList");

async function loadPlaylist() {
  try {
    if (!playlistId) {
      throw new Error("Playlist ID is missing in the URL parameters.");
    }

    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&key=${apiKey}&maxResults=20`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      videoList.innerHTML = "<p>No videos found in this playlist.</p>";
      return;
    }

    displayVideos(data.items);
  } catch (error) {
    console.error("Error loading playlist:", error);
    videoList.innerHTML = `<p>Error loading playlist: ${error.message}</p>`;
  }
}

function displayVideos(videos) {
  videoList.innerHTML = "";

  videos.forEach((video, index) => {
    const videoId = video.snippet.resourceId.videoId;
    const videoTitle = video.snippet.title;
    const thumbnailUrl = video.snippet.thumbnails.default.url;

    const videoItem = document.createElement("div");
    videoItem.className = "video-item";
    videoItem.innerHTML = `
      <img src="${thumbnailUrl}" alt="${videoTitle}">
      <p>${videoTitle}</p>
    `;
    videoItem.onclick = () => playVideo(videoId, videoTitle);
    videoList.appendChild(videoItem);

    if (index === 0 && !lastVideoId) {
      playVideo(videoId, videoTitle);
    }

    if (lastVideoId && videoId === lastVideoId) {
      playVideo(videoId, videoTitle);
    }
  });
}

function playVideo(videoId, videoTitle) {
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
  
  localStorage.setItem("lastPlayedVideo", JSON.stringify({
    playlistId: playlistId,
    videoId: videoId,
    title: videoTitle
  }));
}

loadPlaylist();