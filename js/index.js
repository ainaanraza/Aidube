
import { auth, db } from "./firebase.js";
import { doc, setDoc, getDoc, getDocs, collection, deleteDoc, query, orderBy, addDoc, onSnapshot }
from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";


const lectureHistory = JSON.parse(localStorage.getItem("lectureHistory")) || [];
const savedPlaylists = JSON.parse(localStorage.getItem("savedPlaylists")) || [];
const lastPlayedVideo = JSON.parse(localStorage.getItem("lastPlayedVideo"));

const params = new URLSearchParams(window.location.search);
const searchQuery = params.get("search");

if (searchQuery) {
  document.getElementById("searchInput").value = searchQuery;
  fetchPlaylists(); // Automatically fetch playlists based on the query
}

function toggleSidebar() {
  const sidebar = document.querySelector(".sidebar");
  sidebar.classList.toggle("open");
}

async function loadPlaylistsFromCloud() {
  const user = auth.currentUser;
  if (!user) return null;
  const q = query(collection(db, "users", user.uid, "playlists"), orderBy("savedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

async function clearAllSavedPlaylists() {
    localStorage.removeItem("savedPlaylists");
    updateSavedPlaylists();

    const user = auth.currentUser;
    if (user) {
      const snap = await getDocs(collection(db, "users", user.uid, "playlists"));
      for (const docSnap of snap.docs) {
        await deleteDoc(docSnap.ref);
      }
  
}
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
  if (!container) return; // Add this line to exit if container doesn't exist

  if (lastPlayedVideo) {
    const thumbnailUrl = `https://img.youtube.com/vi/${lastPlayedVideo.videoId}/hqdefault.jpg`;
    container.innerHTML = `
      <div class="last-played compact-last">
        <div class="last-thumb">
          <img src="${thumbnailUrl}" alt="${lastPlayedVideo.title}" onerror="this.src='https://via.placeholder.com/120x70?text=No+Thumbnail'">
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
  let lectureHistory = JSON.parse(localStorage.getItem("lectureHistory")) || [];

  if (!historyDiv) return;

  // Filter out invalid playlist IDs
  lectureHistory = lectureHistory.filter(item => isValidPlaylistId(item.id));

  if (lectureHistory.length === 0) {
    historyDiv.innerHTML = "<p>No lecture history available.</p>";
    return;
  }

  historyDiv.innerHTML = lectureHistory.map((item, index) => {
    const safeTitle = item.title.replace(/'/g, "\\'").replace(/"/g, '\\"');
    return `
    <div class="history-item">
      <img src="${item.thumbnail}" 
           alt="${item.title}" 
           class="history-thumb"
           onerror="this.src='https://via.placeholder.com/120x70?text=No+Image'">
      <div class="history-info">
        <p class="history-title">${item.title}</p>
        <div class="history-actions">
          <button onclick="redirectToPlaylistPage('${item.id}', '${safeTitle}')">
            <i class="fas fa-play"></i> View
          </button>
          <button onclick="removeLectureHistory(${index})">
            <i class="fas fa-trash"></i> Delete
          </button>
          <button onclick="savePlaylist('${safeTitle}', '${item.id}')">
            <i class="fas fa-bookmark"></i> Save
          </button>
        </div>
      </div>
    </div>
  `}).join("");

  localStorage.setItem("lectureHistory", JSON.stringify(lectureHistory));
}


function updateSavedPlaylists() {
   const div = document.getElementById("savedPlaylists");
  if (!div) return; 
  const playlists = JSON.parse(localStorage.getItem("savedPlaylists")) || [];
  div.innerHTML = playlists.length
    ? playlists.map((p, i) => `
      <div>
        <span>${p.title}</span>
        <div>
          <button onclick="redirectToPlaylistPage('${p.id}','${p.title}')">View</button>
          <button onclick="removeSavedPlaylist(${i})">Delete</button>
        </div>
      </div>
    `).join("")
    : "<p>No saved playlists available.</p>";
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


      const user = auth.currentUser;
      if (user) {
        setDoc(doc(db, "users", user.uid, "lastSearch", "latest"), {
          query: searchQuery,
          results: data.items
        }).catch(error => console.error("Error saving last search to Firestore:", error));
      }

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
    // Only process actual playlists, not videos
    if (!item.id.playlistId || !isValidPlaylistId(item.id.playlistId)) {
      return; // Skip this item
    }

    const playlistId = item.id.playlistId;
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
          <button onclick="redirectToPlaylistPage('${playlistId}', '${playlistTitle}', '${thumbnail}')">
            <i class="fas fa-play"></i> View
          </button>
          <button onclick="savePlaylist('${playlistTitle}', '${playlistId}')">
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

function redirectToPlaylistPage(playlistId, title, thumbnail) {
  saveToLectureHistory(title, playlistId, thumbnail);
  window.location.href = `playlist.html?playlistId=${playlistId}`;
}


function isValidPlaylistId(id) {
  return id && id.length > 11 && (id.startsWith('PL') || id.startsWith('UU') || id.startsWith('FL'));
}

async function saveToLectureHistory(title, id, thumbnailUrl = null) {
  // Validate playlist ID before saving
  if (!isValidPlaylistId(id)) {
    console.warn(`Invalid playlist ID "${id}" - not saving to history`);
    return;
  }

  const history = JSON.parse(localStorage.getItem("lectureHistory")) || [];
  const thumbnail = thumbnailUrl || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

  // Avoid duplicates
  const existing = history.find(h => h.id === id);
  if (!existing) {
    history.unshift({ title, id, thumbnail, playedAt: Date.now() });
    localStorage.setItem("lectureHistory", JSON.stringify(history));
    updateLectureHistory(); 
  }

  const user = auth.currentUser;
  if (user) {
    await setDoc(doc(db, "users", user.uid, "history", id), {
      title,
      id,
      thumbnail,
      playedAt: Date.now()
    }, { merge: true });
  }
}


async function savePlaylist(title, id) {
  try {
    // Decode any encoded characters in title
    const decodedTitle = decodeURIComponent(title.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec)));
    
    const playlists = JSON.parse(localStorage.getItem("savedPlaylists")) || [];
    
    if (!playlists.some(p => p.id === id)) {
      playlists.push({ title: decodedTitle, id, savedAt: Date.now() });
      localStorage.setItem("savedPlaylists", JSON.stringify(playlists));
      updateSavedPlaylists();
      showNotification(`Playlist "${decodedTitle}" saved locally.`, "success");
    } else {
      showNotification(`"${decodedTitle}" is already saved.`, "info");
    }

    // Mirror to cloud
    const user = auth.currentUser;
    if (user) {
      await setDoc(doc(db, "users", user.uid, "playlists", id), {
        title: decodedTitle, 
        id, 
        savedAt: Date.now(),
      }, { merge: true });
    }
  } catch (error) {
    console.error("Error saving playlist:", error);
    showNotification("Error saving playlist", "error");
  }
}

async function removeSavedPlaylist(index) {
  const savedPlaylists = JSON.parse(localStorage.getItem("savedPlaylists")) || [];
  const removed = savedPlaylists[index]; // capture before removing

  // remove locally
  savedPlaylists.splice(index, 1);
  localStorage.setItem("savedPlaylists", JSON.stringify(savedPlaylists));
  updateSavedPlaylists();

  // remove from Firestore
  const user = auth.currentUser;
  if (user && removed?.id) {
    try {
      await deleteDoc(doc(db, "users", user.uid, "playlists", removed.id));
      console.log(` Playlist "${removed.title}" deleted from Firestore`);
    } catch (e) {
      console.error("Firestore delete failed:", e);
    }
  }
}





window.removeLectureHistory = async function(index) {
    const lectureHistory = JSON.parse(localStorage.getItem("lectureHistory")) || [];
    const removedItem = lectureHistory[index];
    
    // Remove from local storage
    lectureHistory.splice(index, 1);
    localStorage.setItem("lectureHistory", JSON.stringify(lectureHistory));
    updateLectureHistory();

    // Remove from Firestore to prevent real-time listener from re-adding it
    const user = auth.currentUser;
    if (user && removedItem?.id) {
        try {
            await deleteDoc(doc(db, "users", user.uid, "history", removedItem.id));
            console.log(`Removed "${removedItem.title}" from Firestore history`);
        } catch (error) {
            console.error("Error removing from Firestore:", error);
            showNotification("Error removing from cloud history", "error");
        }
    }
};

function clearAllLectureHistory() {
  localStorage.removeItem("lectureHistory");
  updateLectureHistory();
}


function updateSavedRoadmaps() {
  const roadmaps = JSON.parse(localStorage.getItem("savedRoadmaps")) || [];
  const div = document.getElementById("savedRoadmaps");
  div.innerHTML = roadmaps.length
    ? roadmaps.map((r, i) => `
      <div>
        <span>${r.topic}</span>
        <div>
          <button onclick="viewSavedRoadmap('${r.topic}')">View</button>
          <button onclick="deleteSavedRoadmap(${i})">Delete</button>
        </div>
      </div>
    `).join("")
    : "<p>No saved roadmaps available.</p>";
}

function viewSavedRoadmap(topic) {
  window.location.href = `roadmap.html?topic=${encodeURIComponent(topic)}`;
}

async function deleteSavedRoadmap(index) {
  const roadmaps = JSON.parse(localStorage.getItem("savedRoadmaps")) || [];
  const removed = roadmaps.splice(index, 1)[0];
  localStorage.setItem("savedRoadmaps", JSON.stringify(roadmaps));
  updateSavedRoadmaps();

  const user = auth.currentUser;
  if (user && removed?.topic) {
    const snap = await getDocs(collection(db, "users", user.uid, "roadmaps"));
    snap.forEach(async docSnap => {
      const data = docSnap.data();
      if (data.topic === removed.topic) await deleteDoc(docSnap.ref);
    });
  }
}


async function clearAllRoadmaps() {
  localStorage.removeItem("savedRoadmaps");
  updateSavedRoadmaps();

  const user = auth.currentUser;
  if (user) {
    const snap = await getDocs(collection(db, "users", user.uid, "roadmaps"));
    snap.forEach(async d => await deleteDoc(d.ref));
  }
}


const activeQuery = params.get("search");

if (!activeQuery) {
  const searchInput = document.getElementById("searchInput");
if (auth.currentUser && searchInput) {
  // Load last search from Firestore
  const docRef = doc(db, "users", auth.currentUser.uid, "lastSearch", "latest");
  getDoc(docRef)
    .then(docSnap => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        searchInput.value = data.query;
        renderPlaylists(data.results);
      }
    })
    .catch(error => console.error("Error fetching last search from Firestore:", error));
} else if (searchInput) {
  // Fallback to localStorage (if no logged-in user or if desired)
  const savedResults = localStorage.getItem("lastSearchResults");
  const savedQuery = localStorage.getItem("lastSearchQuery");
  if (savedResults && savedQuery) {
    searchInput.value = savedQuery;
    renderPlaylists(JSON.parse(savedResults));
  }
}

}


function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === 'success' ? '#d4edda' : type === 'error' ? '#f8d7da' : '#d1ecf1'};
        color: ${type === 'success' ? '#155724' : type === 'error' ? '#721c24' : '#0c5460'};
        border: 1px solid ${type === 'success' ? '#c3e6cb' : type === 'error' ? '#f5c6cb' : '#bee5eb'};
        border-radius: 8px;
        z-index: 10000;
        animation: slideIn 0.3s ease;
        max-width: 300px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}


if (document.getElementById("lectureHistory")) {
  updateLectureHistory();
}
updateSavedPlaylists();
renderLastPlayed();
updateSavedRoadmaps();

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  try {
    const cloud = await loadPlaylistsFromCloud();
    if (cloud && cloud.length) {
      // merge cloud into local and re-render sidebar
      const local = JSON.parse(localStorage.getItem("savedPlaylists") || "[]");
      const merged = [...cloud, ...local].reduce((acc, p) => {
        if (!acc.some(x => x.id === p.id)) acc.push(p);
        return acc;
      }, []);
      localStorage.setItem("savedPlaylists", JSON.stringify(merged));
      updateSavedPlaylists();
    }
  } catch (e) {
    console.warn("Load cloud playlists failed:", e);
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  // migrate playlists
  try {
    const localPlaylists = JSON.parse(localStorage.getItem("savedPlaylists") || "[]");
    for (const p of localPlaylists) {
      await setDoc(doc(db, "users", user.uid, "playlists", p.id), {
        title: p.title, id: p.id, savedAt: Date.now()
      }, { merge: true });
    }
  } catch (e) { console.warn("Playlist migration failed:", e); }

  // migrate history
  try {
    const localHistory = JSON.parse(localStorage.getItem("lectureHistory") || "[]");
    for (const h of localHistory) {
      await setDoc(doc(db, "users", user.uid, "history", h.id), {
        title: h.title, id: h.id, thumbnail: h.thumbnail || null, playedAt: Date.now()
      }, { merge: true });
    }
  } catch (e) { console.warn("History migration failed:", e); }

  // migrate roadmaps
  try {
    const localRoadmaps = JSON.parse(localStorage.getItem("savedRoadmaps") || "[]");
const snap = await getDocs(collection(db, "users", user.uid, "roadmaps"));
const existingTopics = snap.docs.map(d => d.data().topic);

for (const r of localRoadmaps) {
  if (!existingTopics.includes(r.topic)) {
    await addDoc(collection(db, "users", user.uid, "roadmaps"), {
      topic: r.topic, steps: r.steps, savedAt: Date.now()
    });
  }
}
  } catch (e) { console.warn("Roadmap migration failed:", e); }
});

onAuthStateChanged(auth, (user) => {
  const userInfo = document.getElementById("userInfo");
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  if (user) {
    if (userInfo)
      userInfo.innerHTML = `
        <img src="${user.photoURL}" style="width:50px;border-radius:50%">
        <p>${user.displayName || "User"}</p>
        <p style="font-size:0.9em;color:#555">${user.email}</p>
      `;
    if (loginBtn) loginBtn.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "inline-block";

    // 🔄 Start real-time Firestore syncing
    watchUserRoadmaps()
    watchUserHistory()

  } else {
    if (userInfo) userInfo.textContent = "Not logged in";
    if (loginBtn) loginBtn.style.display = "inline-block";
    if (logoutBtn) logoutBtn.style.display = "none";
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    updateSavedPlaylists();
    updateSavedRoadmaps();
    updateLectureHistory();
  }
});



function watchUserRoadmaps() {
  const user = auth.currentUser;
  if (!user) return;
  const ref = collection(db, "users", user.uid, "roadmaps");
  onSnapshot(ref, (snap) => {
    const roadmaps = snap.docs.map(d => d.data());
    localStorage.setItem("savedRoadmaps", JSON.stringify(roadmaps));
    updateSavedRoadmaps();
  });
}

function watchUserHistory() {
    const user = auth.currentUser;
    if (!user) return;
    
    const ref = collection(db, "users", user.uid, "history");
    let isFirstSync = true;
    
    onSnapshot(ref, (snap) => {
        const cloudHistory = snap.docs.map(d => ({
            ...d.data(),
            // Add document ID for consistency
            _firestoreId: d.id
        }));
        
        if (isFirstSync) {
            localStorage.setItem("lectureHistory", JSON.stringify(cloudHistory));
            updateLectureHistory();
            isFirstSync = false;
        } else {
            // Subsequent updates: merge strategically
            const localHistory = JSON.parse(localStorage.getItem("lectureHistory") || "[]");
            
            // Create a map of local items by ID for quick lookup
            const localMap = new Map();
            localHistory.forEach(item => localMap.set(item.id, item));
            
            // Merge: cloud items not in local should be added
            let hasChanges = false;
            const mergedHistory = [...localHistory];
            
            cloudHistory.forEach(cloudItem => {
                if (!localMap.has(cloudItem.id)) {
                    // New item from cloud, add it
                    mergedHistory.unshift(cloudItem);
                    hasChanges = true;
                }
            });
            
            if (hasChanges) {
                localStorage.setItem("lectureHistory", JSON.stringify(mergedHistory));
                updateLectureHistory();
            }
        }
    });
}
function cleanupInvalidHistory() {
  const lectureHistory = JSON.parse(localStorage.getItem("lectureHistory")) || [];
  const validHistory = lectureHistory.filter(item => isValidPlaylistId(item.id));
  
  if (validHistory.length !== lectureHistory.length) {
    console.log(`Cleaned up ${lectureHistory.length - validHistory.length} invalid history entries`);
    localStorage.setItem("lectureHistory", JSON.stringify(validHistory));
    updateLectureHistory();
  }
}

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    signOut(auth);  // Firebase auth sign-out
  });
}

// Call this once when the app loads
cleanupInvalidHistory();
export { updateLectureHistory, clearAllLectureHistory };


window.redirectToPlaylistPage = redirectToPlaylistPage;
window.removeLectureHistory = removeLectureHistory;
window.savePlaylist = savePlaylist;
window.clearAllLectureHistory = clearAllLectureHistory;
window.updateLectureHistory = updateLectureHistory;
window.fetchPlaylists = fetchPlaylists;
window.redirectToRoadmap = redirectToRoadmap;
window.clearAllSavedPlaylists = clearAllSavedPlaylists;
window.toggleSidebar = toggleSidebar;
window.updateLectureHistory = updateLectureHistory;
window.viewSavedRoadmap = viewSavedRoadmap;
window.deleteSavedRoadmap = deleteSavedRoadmap;
window.clearAllRoadmaps = clearAllRoadmaps;
window.removeSavedPlaylist = removeSavedPlaylist;
window.updateSavedPlaylists = updateSavedPlaylists;





