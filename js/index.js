const lectureHistory = JSON.parse(localStorage.getItem("lectureHistory")) || [];
const savedPlaylists = JSON.parse(localStorage.getItem("savedPlaylists")) || [];
const lastPlayedVideo = JSON.parse(localStorage.getItem("lastPlayedVideo"));

const params = new URLSearchParams(window.location.search);
const searchQuery = params.get("search");

if (searchQuery) {
  document.getElementById("searchInput").value = searchQuery;
  fetchPlaylists(); // Automatically fetch playlists based on the query
}

function redirectToRoadmap() {
  const query = document.getElementById("searchInput").value;
  if (query) {
    window.location.href = `roadmap.html?topic=${encodeURIComponent(query)}`;
  } else {
    alert("Please enter a topic to generate a roadmap.");
  }
}

function renderLastPlayed() {
  const container = document.getElementById("lastPlayedContainer");

  if (lastPlayedVideo) {
    const thumbnailUrl = `https://img.youtube.com/vi/${lastPlayedVideo.videoId}/hqdefault.jpg`;
    container.innerHTML = `
      <div class="last-played compact-last">
        <div class="last-thumb">
          <img src="${thumbnailUrl}" alt="${lastPlayedVideo.title}">
        </div>
        <div class="last-info">
          <div class="last-title">${lastPlayedVideo.title}</div>
          <button class="last-resume-btn" onclick="resumeLastPlayed()">
            <i class="fas fa-play"></i> Resume
          </button>
        </div>
      </div>
    `;
  } else {
    container.innerHTML = "";
  }
}


function updateLectureHistory() {
  const historyDiv = document.getElementById("lectureHistory");
  historyDiv.innerHTML = lectureHistory.length
    ? lectureHistory.map((item, index) => `
      <div>
        <span>${item.title}</span>
        <div>
          <button onclick="redirectToPlaylistPage('${item.id}', '${item.title}')">View</button>
          <button onclick="removeLectureHistory(${index})">Delete</button>
          <button onclick="savePlaylist('${item.title}', '${item.id}')">Save</button>
          </div>
        </div>
        <br>
      </div>
    `).join("")
    : "<p>No lecture history available.</p>";
  localStorage.setItem("lectureHistory", JSON.stringify(lectureHistory));
}

function updateSavedPlaylists() {
  const playlistsDiv = document.getElementById("savedPlaylists");
  playlistsDiv.innerHTML = savedPlaylists.length
    ? savedPlaylists.map((item, index) => `
      <div>
        <span>${item.title}</span>
        <div>
          <button onclick="redirectToPlaylistPage('${item.id}', '${item.title}')">View</button>
          <button onclick="removeSavedPlaylist(${index})">Delete</button>
        </div>
        <br>
      </div>
    `).join("")
    : "<p>No saved playlists available.</p>";
  localStorage.setItem("savedPlaylists", JSON.stringify(savedPlaylists));
}

function fetchPlaylists() {
  const searchQuery = document.getElementById("searchInput").value;
  const apiKey = "AIzaSyB8qZ_7Z7miBrUeo2cRDE6aPwyhe5TVCo8";
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${searchQuery}&type=playlist&key=${apiKey}&maxResults=50`;

  const container = document.getElementById("playlistContainer");
  container.innerHTML = "<p>Loading playlists...</p>";

  fetch(url)
    .then(response => response.json())
    .then(data => {
      if (!data.items || data.items.length === 0) {
        container.innerHTML = "<p>No playlists found.</p>";
        return;
      }


      localStorage.setItem("lastSearchQuery", searchQuery);
      localStorage.setItem("lastSearchResults", JSON.stringify(data.items));

      renderPlaylists(data.items);
    })
    .catch(error => {
      console.error("Error fetching playlists:", error);
      container.innerHTML = `<p>Error fetching playlists: ${error.message}</p>`;
    });
}

function renderPlaylists(playlists) {
  const container = document.getElementById("playlistContainer");
  container.innerHTML = "";

  playlists.forEach(item => {
    const thumbnail = item.snippet.thumbnails.high?.url || item.snippet.thumbnails.default.url;
    const playlistTitle = item.snippet.title;
    const channelTitle = item.snippet.channelTitle;

    const playlistElement = document.createElement("div");
    playlistElement.className = "playlist-item";
    playlistElement.innerHTML = `
      <img src="${thumbnail}" alt="${playlistTitle}" class="playlist-thumbnail">
      <div class="playlist-content">
        <div class="playlist-title">${playlistTitle}</div>
        <div class="playlist-channel">${channelTitle}</div>
        <div class="playlist-buttons">
          <button onclick="redirectToPlaylistPage('${item.id.playlistId}', '${playlistTitle}')">
            <i class="fas fa-play"></i> View
          </button>
          <button onclick="savePlaylist('${playlistTitle}', '${item.id.playlistId}')">
            <i class="fas fa-bookmark"></i> Save
          </button>
        </div>
      </div>
    `;
    container.appendChild(playlistElement);
  });
}


function resumeLastPlayed() {
  if (lastPlayedVideo) {
    const { playlistId, videoId } = lastPlayedVideo;
    window.location.href = `playlist.html?playlistId=${playlistId}&videoId=${videoId}`;
  }
}

function redirectToPlaylistPage(playlistId, title) {
  saveToLectureHistory(title, playlistId);
  window.location.href = `playlist.html?playlistId=${playlistId}`;
}

function saveToLectureHistory(title, id) {
  if (!lectureHistory.some(item => item.id === id)) {
    lectureHistory.push({ title, id });
    updateLectureHistory();
  }
}

function savePlaylist(title, id) {
  if (!savedPlaylists.some(item => item.id === id)) {
    savedPlaylists.push({ title, id });
    updateSavedPlaylists();
  }
}

function removeLectureHistory(index) {
  lectureHistory.splice(index, 1);
  updateLectureHistory();
}

function removeSavedPlaylist(index) {
  savedPlaylists.splice(index, 1);
  updateSavedPlaylists();
}

function clearAllLectureHistory() {
  lectureHistory.length = 0;
  updateLectureHistory();
}

function clearAllSavedPlaylists() {
  savedPlaylists.length = 0;
  updateSavedPlaylists();
}

function updateSavedRoadmaps() {
  const savedRoadmaps = JSON.parse(localStorage.getItem("savedRoadmaps")) || [];
  const roadmapsDiv = document.getElementById("savedRoadmaps");
  roadmapsDiv.innerHTML = savedRoadmaps.length
    ? savedRoadmaps.map((roadmap, index) => `
      <div>
        <span>${roadmap.topic}</span>
        <div>
          <button onclick="viewSavedRoadmap('${roadmap.topic}')">View</button>
          <button onclick="deleteSavedRoadmap(${index})">Delete</button>
        </div>
        <br>
      </div>
    `).join("")
    : "<p>No saved roadmaps available.</p>";
}

//  view a saved roadmap
function viewSavedRoadmap(topic) {
  window.location.href = `roadmap.html?topic=${encodeURIComponent(topic)}`;
}

//   delete a saved roadmap
function deleteSavedRoadmap(index) {
  const savedRoadmaps = JSON.parse(localStorage.getItem("savedRoadmaps")) || [];
  savedRoadmaps.splice(index, 1); // Remove the roadmap at the specified index
  localStorage.setItem("savedRoadmaps", JSON.stringify(savedRoadmaps));
  updateSavedRoadmaps(); // Refresh the displayed roadmaps
}

//   clear all saved roadmaps
function clearAllRoadmaps() {
  localStorage.removeItem("savedRoadmaps"); // Remove all saved roadmaps
  updateSavedRoadmaps(); // Refresh the displayed roadmaps
}

const activeQuery = params.get("search");

if (!activeQuery) {
  const savedResults = localStorage.getItem("lastSearchResults");
  const savedQuery = localStorage.getItem("lastSearchQuery");

  if (savedResults && savedQuery) {
    document.getElementById("searchInput").value = savedQuery;
    renderPlaylists(JSON.parse(savedResults));
  }
}


updateLectureHistory();
updateSavedPlaylists();
renderLastPlayed();
updateSavedRoadmaps();