import { auth, db, analytics, setUserId, logEvent } from "./firebase.js";
import { doc, setDoc, getDoc, getDocs, collection, deleteDoc, query, orderBy, addDoc, onSnapshot }
  from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import { getYouTubeApiKey, rotateYouTubeKey, isValidPlaylistId, retryOperation, showNotification, sanitizeHTML } from "./utils.js";

const lectureHistory = JSON.parse(localStorage.getItem("lectureHistory")) || [];
const savedPlaylists = JSON.parse(localStorage.getItem("savedPlaylists")) || [];
const lastPlayedVideo = JSON.parse(localStorage.getItem("lastPlayedVideo"));

const params = new URLSearchParams(window.location.search);
const searchQuery = params.get("search");

if (searchQuery) {
  document.getElementById("searchInput").value = searchQuery;
  fetchPlaylists(); // Automatically fetch playlists based on the query
}

const searchInputEl = document.getElementById("searchInput");
if (searchInputEl) {
  searchInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      fetchPlaylists();
    }
  });
}

function toggleSidebar() {
  const sidebar = document.querySelector(".sidebar");
  sidebar.classList.toggle("open");
}

function openProfileDrawer() {
  document.getElementById("profileDrawer")?.classList.add("open");
  document.getElementById("drawerOverlay")?.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeProfileDrawer() {
  document.getElementById("profileDrawer")?.classList.remove("open");
  document.getElementById("drawerOverlay")?.classList.remove("open");
  document.body.style.overflow = "";
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
    try {
      const snap = await getDocs(collection(db, "users", user.uid, "playlists"));
      for (const docSnap of snap.docs) {
        await deleteDoc(docSnap.ref);
      }
    } catch (e) {
      // Firestore clear playlists failed
    }
  }
}

function redirectToRoadmap() {
  const user = auth.currentUser;
  if (!user) {
    showNotification("You must be logged in to create a roadmap.", "warning");
    return;
  }


  const query = document.getElementById("searchInput").value;
  if (query) {
    window.location.href = `roadmap.html?topic=${encodeURIComponent(query)}`;
  } else {
    showNotification("Please enter a topic to generate a roadmap.", "warning");
  }
}

function renderLastPlayed() {
  const container = document.getElementById("lastPlayedContainer");
  if (!container) return;

  if (lastPlayedVideo) {
    const thumbnailUrl = `https://img.youtube.com/vi/${lastPlayedVideo.videoId}/hqdefault.jpg`;
    container.innerHTML = `
      <div class="last-played-banner">
        <div class="last-played-thumb">
          <img src="${thumbnailUrl}" alt="${lastPlayedVideo.title}" onerror="this.src='https://via.placeholder.com/180x100?text=No+Thumbnail'">
        </div>
        <div class="last-played-info">
          <p style="text-transform: uppercase; font-size: 0.7rem; font-weight: 800; letter-spacing: 0.1em; opacity: 0.8; margin-bottom: 0.25rem;">Continue Journey</p>
          <h4>${sanitizeHTML(lastPlayedVideo.title)}</h4>
          <button class="btn-secondary" style="background: white; color: var(--primary); border: none;" onclick="resumeLastPlayed()">
            <i class="fas fa-play"></i> Resume Lesson
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
      <img src="${sanitizeHTML(item.thumbnail)}" 
           alt="${sanitizeHTML(item.title)}" 
           class="history-thumb"
           onerror="this.src='https://via.placeholder.com/120x70?text=No+Image'">
      <div class="history-info">
        <p class="history-title">${sanitizeHTML(item.title)}</p>
        <div class="history-actions">
          <button onclick="redirectToPlaylistPage('${sanitizeHTML(item.id)}', '${safeTitle}')">
            <i class="fas fa-play"></i> View
          </button>
          <button onclick="removeLectureHistory(${index})">
            <i class="fas fa-trash"></i> Delete
          </button>
          <button onclick="savePlaylist('${safeTitle}', '${sanitizeHTML(item.id)}')">
            <i class="fas fa-bookmark"></i> Save
          </button>
        </div>
      </div>
    </div>
  `}).join("");

  localStorage.setItem("lectureHistory", JSON.stringify(lectureHistory));
}


function updateSavedPlaylists() {
  const playlists = JSON.parse(localStorage.getItem("savedPlaylists")) || [];

  // Update Sidebar
  const div = document.getElementById("savedPlaylists");
  if (div) {
    div.innerHTML = renderPlaylistItems(playlists);
  }

  // Update Drawer
  const drawerDiv = document.getElementById("drawerSavedPlaylists");
  if (drawerDiv) {
    drawerDiv.innerHTML = renderPlaylistItems(playlists);
  }
}

function renderPlaylistItems(playlists) {
  return playlists.length
    ? playlists.map((p, i) => `
      <div class="saved-item">
        <div class="saved-item-title">${sanitizeHTML(p.title)}</div>
        <div class="saved-item-info">
          <button class="btn-ghost" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="redirectToPlaylistPage('${sanitizeHTML(p.id)}','${sanitizeHTML(p.title)}')">
            <i class="fas fa-external-link-alt"></i> View
          </button>
          <button class="btn-ghost" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: #ef4444;" onclick="removeSavedPlaylist(${i})">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `).join("")
    : "<p style='font-size: 0.825rem; color: var(--text-muted); text-align: center;'>No saved playlists</p>";
}


async function fetchPlaylists() {
  const searchQuery = document.getElementById("searchInput").value;

  // Hide Resume section on search so results are visible immediately
  const lastPlayedContainer = document.getElementById("lastPlayedContainer");
  if (lastPlayedContainer) {
    lastPlayedContainer.style.display = "none";
  }

  const container = document.getElementById("playlistContainer");
  container.innerHTML = "<p>Loading playlists...</p>";

  try {
    const data = await retryOperation(async () => {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${searchQuery}&type=playlist&key=${getYouTubeApiKey()}&maxResults=50`;
      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`YouTube API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
      }
      return await response.json();
    }, 3, 1000, rotateYouTubeKey);

    if (!data.items || data.items.length === 0) {
      container.innerHTML = "<p>No playlists found.</p>";
      return;
    }

    localStorage.setItem("lastSearchQuery", searchQuery);
    localStorage.setItem("lastSearchResults", JSON.stringify(data.items));

    const user = auth.currentUser;
    if (user) {
      setDoc(doc(db, "users", user.uid, "lastSearch", "latest"), {
        query: searchQuery,
        results: data.items
      }).catch(() => { });
    }

    renderPlaylists(data.items);

  } catch (error) {
    // Error fetching playlists
    container.innerHTML = `<p>Error fetching playlists: ${error.message}</p>`;
  }
}

function renderPlaylists(playlists) {
  const container = document.getElementById("playlistContainer");
  container.innerHTML = "";

  playlists.forEach(item => {
    if (!item.id.playlistId || !isValidPlaylistId(item.id.playlistId)) {
      return;
    }

    const playlistId = item.id.playlistId;
    const thumbnail = item.snippet.thumbnails.high?.url || item.snippet.thumbnails.default.url;
    const playlistTitle = item.snippet.title;
    const channelTitle = item.snippet.channelTitle;

    const playlistElement = document.createElement("div");
    playlistElement.className = "playlist-card";
    playlistElement.innerHTML = `
      <div class="thumbnail-container">
        <img src="${sanitizeHTML(thumbnail)}" alt="${sanitizeHTML(playlistTitle)}">
        <div class="video-count-badge">
          <i class="fas fa-list"></i> Playlist
        </div>
      </div>
      <div class="card-content">
        <div class="card-title">${sanitizeHTML(playlistTitle)}</div>
        <div class="card-meta">
          <span><i class="fas fa-user-circle"></i> ${sanitizeHTML(channelTitle)}</span>
        </div>
        <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
          <button class="btn-primary" style="flex: 1; justify-content: center;" onclick="redirectToPlaylistPage('${sanitizeHTML(playlistId)}', '${sanitizeHTML(playlistTitle)}', '${sanitizeHTML(thumbnail)}')">
            Play
          </button>
          <button class="btn-secondary" style="padding: 0.5rem;" onclick="savePlaylist('${sanitizeHTML(playlistTitle)}', '${sanitizeHTML(playlistId)}')">
            <i class="fas fa-bookmark"></i>
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

async function saveToLectureHistory(title, id, thumbnailUrl = null) {
  // Validate playlist ID before saving
  if (!isValidPlaylistId(id)) {
    // Invalid playlist ID
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
    try {
      await setDoc(doc(db, "users", user.uid, "history", id), {
        title,
        id,
        thumbnail,
        playedAt: Date.now()
      }, { merge: true });
    } catch (e) {
      // Firestore save history failed
    }
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
    // Error saving playlist
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
      // Playlist deleted from Firestore
    } catch (e) {
      // Firestore delete failed
    }
  }
}





window.removeLectureHistory = async function (index) {
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
      // Removed from Firestore history
    } catch (error) {
      // Error removing from Firestore
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

  // Update Sidebar
  const div = document.getElementById("savedRoadmaps");
  if (div) {
    div.innerHTML = renderRoadmapItems(roadmaps);
  }

  // Update Drawer
  const drawerDiv = document.getElementById("drawerSavedRoadmaps");
  if (drawerDiv) {
    drawerDiv.innerHTML = renderRoadmapItems(roadmaps);
  }
}

function renderRoadmapItems(roadmaps) {
  return roadmaps.length
    ? roadmaps.map((r, i) => `
      <div class="saved-item">
        <div class="saved-item-title">${sanitizeHTML(r.topic)}</div>
        <div class="saved-item-info">
          <button class="btn-ghost" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="viewSavedRoadmap('${sanitizeHTML(r.topic)}')">
            <i class="fas fa-map-marked-alt"></i> Journey
          </button>
          <button class="btn-ghost" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: #ef4444;" onclick="deleteSavedRoadmap(${i})">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `).join("")
    : "<p style='font-size: 0.825rem; color: var(--text-muted); text-align: center'>No journeys saved</p>";
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
    try {
      const snap = await getDocs(collection(db, "users", user.uid, "roadmaps"));
      snap.forEach(async docSnap => {
        const data = docSnap.data();
        if (data.topic === removed.topic) await deleteDoc(docSnap.ref);
      });
    } catch (e) {
      // Firestore delete roadmap failed
    }
  }
}


async function clearAllRoadmaps() {
  localStorage.removeItem("savedRoadmaps");
  updateSavedRoadmaps();

  const user = auth.currentUser;
  if (user) {
    try {
      const snap = await getDocs(collection(db, "users", user.uid, "roadmaps"));
      snap.forEach(async d => await deleteDoc(d.ref));
    } catch (e) {
      // Firestore clear roadmaps failed
    }
  }
}


const activeQuery = params.get("search");

if (!activeQuery) {
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    const savedResults = localStorage.getItem("lastSearchResults");
    const savedQuery = localStorage.getItem("lastSearchQuery");
    if (savedResults && savedQuery && savedResults !== "undefined") {
      searchInput.value = savedQuery;
      renderPlaylists(JSON.parse(savedResults));

      const lastPlayedContainer = document.getElementById("lastPlayedContainer");
      if (lastPlayedContainer) {
        lastPlayedContainer.style.display = "none";
      }
    }
  }
}





if (document.getElementById("lectureHistory")) {
  updateLectureHistory();
}
updateSavedPlaylists();
renderLastPlayed();
updateSavedRoadmaps();

// Profile Caching
function renderCachedProfile() {
  const cachedProfile = JSON.parse(localStorage.getItem("userProfile"));
  const userInfo = document.getElementById("userInfo");
  const drawerUserInfo = document.getElementById("drawerUserInfo");
  const dLogout = document.getElementById("drawerLogoutBtn");

  if (cachedProfile) {
    if (userInfo) {
      userInfo.innerHTML = `
        <div class="user-avatar">
          <img src="${cachedProfile.photoURL}" style="width:100%; height:100%; border-radius:50%">
        </div>
        <div class="user-details">
          <p>${sanitizeHTML(cachedProfile.displayName)}</p>
          <span>${sanitizeHTML(cachedProfile.email)}</span>
        </div>
      `;
    }
    if (drawerUserInfo) {
      drawerUserInfo.innerHTML = `
           <div class="user-avatar">
             <img src="${cachedProfile.photoURL}" style="width:100%; height:100%; border-radius:50%">
           </div>
           <h3>${sanitizeHTML(cachedProfile.displayName)}</h3>
           <p>${sanitizeHTML(cachedProfile.email)}</p>
         `;
    }
    if (dLogout) dLogout.style.display = "flex";
  }
}

// Render cached profile immediately on load
renderCachedProfile();

// Consolidate Auth Logic
onAuthStateChanged(auth, async (user) => {
  const userInfo = document.getElementById("userInfo");
  const drawerUserInfo = document.getElementById("drawerUserInfo");
  const dLogout = document.getElementById("drawerLogoutBtn");

  if (user) {
    // 1. Update Profile & Cache
    const profileData = {
      displayName: user.displayName || "Learner",
      email: user.email,
      photoURL: user.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.displayName || 'User') + '&background=random'
    };
    localStorage.setItem("userProfile", JSON.stringify(profileData));
    renderCachedProfile(); // Update UI with fresh data

    // 2. Set Analytics User ID
    setUserId(analytics, user.uid);
    logEvent(analytics, 'login', { method: 'firebase_auth' });

    // 3. Update Lists (Local/UI)
    updateSavedPlaylists();
    updateSavedRoadmaps();
    updateLectureHistory();

    // 4. Cloud Sync - Download
    try {
      const cloud = await loadPlaylistsFromCloud();
      if (cloud && cloud.length) {
        const local = JSON.parse(localStorage.getItem("savedPlaylists") || "[]");
        const merged = [...cloud, ...local].reduce((acc, p) => {
          if (!acc.some(x => x.id === p.id)) acc.push(p);
          return acc;
        }, []);
        localStorage.setItem("savedPlaylists", JSON.stringify(merged));
        updateSavedPlaylists();
      }
    } catch (e) { /* Load cloud playlists failed */ }

    // 5. Cloud Sync - Upload (Migration) - Optimized to run once per session (1 hour)
    const lastMigration = parseInt(localStorage.getItem("lastMigrationTimestamp") || "0");
    const ONE_HOUR = 60 * 60 * 1000;

    if (Date.now() - lastMigration > ONE_HOUR) {
      // Perform full migration
      try {
        const localPlaylists = JSON.parse(localStorage.getItem("savedPlaylists") || "[]");
        for (const p of localPlaylists) {
          await setDoc(doc(db, "users", user.uid, "playlists", p.id), {
            title: p.title, id: p.id, savedAt: Date.now()
          }, { merge: true });
        }
      } catch (e) { /* Playlist migration failed */ }

      try {
        const localHistory = JSON.parse(localStorage.getItem("lectureHistory") || "[]");
        for (const h of localHistory) {
          await setDoc(doc(db, "users", user.uid, "history", h.id), {
            title: h.title, id: h.id, thumbnail: h.thumbnail || null, playedAt: Date.now()
          }, { merge: true });
        }
      } catch (e) { /* History migration failed */ }

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
      } catch (e) { /* Roadmap migration failed */ }

      localStorage.setItem("lastMigrationTimestamp", Date.now().toString());
    }

    // 6. Setup Listeners
    watchUserRoadmaps();
    watchUserHistory();

    // 7. Field of Interest (First Login Experience)
    const profileRef = doc(db, "users", user.uid, "profile", "settings");
    getDoc(profileRef).then((profileSnap) => {
      let hasInterest = false;
      let interestVal = "";

      if (profileSnap.exists() && profileSnap.data().interest) {
        hasInterest = true;
        interestVal = profileSnap.data().interest;
      }

      const modal = document.getElementById("interestModal");
      const overlay = document.getElementById("interestModalOverlay");

      if (!hasInterest) {
        // First login! Ask for interest
        if (modal && overlay) {
          modal.style.display = "block";
          overlay.style.display = "block";

          const submitInterest = async () => {
            const interestInput = document.getElementById("interestInput").value.trim();
            if (interestInput) {
              // Save to Firebase
              await setDoc(profileRef, { interest: interestInput }, { merge: true });

              // Hide modal
              modal.style.display = "none";
              overlay.style.display = "none";

              // Set UI & fetch
              const searchInput = document.getElementById("searchInput");
              if (searchInput) {
                searchInput.value = interestInput;
                fetchPlaylists(); // Trigger search and recommendations
              }
              showNotification("Your personalized feed is ready!", "success");
            } else {
              showNotification("Please enter a field of interest.", "warning");
            }
          };

          document.getElementById("saveInterestBtn").onclick = submitInterest;
          document.getElementById("interestInput").addEventListener("keydown", (e) => {
            if (e.key === "Enter") submitInterest();
          });
        }
      } else {
        // Returning user with an interest
        // Auto-fill and search if they don't have an active query or cached search from session
        const activeQuery = new URLSearchParams(window.location.search).get("search");
        const savedQuery = localStorage.getItem("lastSearchQuery");

        if (!activeQuery && !savedQuery) {
          const searchInput = document.getElementById("searchInput");
          if (searchInput) {
            searchInput.value = interestVal;
            fetchPlaylists();
          }
        }
      }
    }).catch(console.error);

  } else {
    // No User
    localStorage.removeItem("userProfile"); // Clear sensitive cache
    setUserId(analytics, null);

    // Reset UI to Guest
    if (userInfo) {
      userInfo.innerHTML = `
        <div class="user-avatar"><i class="fas fa-user-circle"></i></div>
        <div class="user-details">
          <p>Guest Explorer</p>
          <span>Sign in for full access</span>
        </div>
      `;
    }
    if (drawerUserInfo) {
      drawerUserInfo.innerHTML = `
        <div class="user-avatar" style="background: var(--text-muted);"><i class="fas fa-user-circle"></i></div>
        <h3>Guest Explorer</h3>
        <p>Sign in to save your progress</p>
        <button class="btn-primary" onclick="window.location.href='login.html'" style="margin-top:0.5rem;">Sign In</button>
      `;
    }
    if (dLogout) dLogout.style.display = "none";
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
  }, (error) => {
    // Firestore roadmap sync failed
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
      // First sync: always use cloud data
      // Initial history sync from cloud
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
        // Merging new items from cloud history
        localStorage.setItem("lectureHistory", JSON.stringify(mergedHistory));
        updateLectureHistory();
      }
    }
  }, (error) => {
    // Firestore history sync failed
  });
}
function cleanupInvalidHistory() {
  const lectureHistory = JSON.parse(localStorage.getItem("lectureHistory")) || [];
  const validHistory = lectureHistory.filter(item => isValidPlaylistId(item.id));

  if (validHistory.length !== lectureHistory.length) {
    // Cleaned up invalid history entries
    localStorage.setItem("lectureHistory", JSON.stringify(validHistory));
    updateLectureHistory();
  }
}


const drawerLogoutBtn = document.getElementById("drawerLogoutBtn");

function handleLogout() {
  signOut(auth);
  closeProfileDrawer();
}


if (drawerLogoutBtn) {
  drawerLogoutBtn.addEventListener("click", handleLogout);
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
window.resumeLastPlayed = resumeLastPlayed;
window.closeProfileDrawer = closeProfileDrawer;
window.openProfileDrawer = openProfileDrawer;
window.removeSavedPlaylist = removeSavedPlaylist;
window.updateSavedPlaylists = updateSavedPlaylists;
window.resumeLastPlayed = resumeLastPlayed;
