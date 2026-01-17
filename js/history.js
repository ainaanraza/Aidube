import { auth, db } from "./firebase.js";
import {
    setDoc,
    doc,
    deleteDoc,
    collection,
    getDocs,
    query
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
import { showNotification } from "./utils.js";

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

// Clears all lecture history (localStorage and Firestore)
window.clearAllLectureHistory = async function () {
    // Remove from localStorage
    localStorage.removeItem("lectureHistory");
    updateLectureHistory();

    // Also clear from Firestore (all 'history' docs)
    const user = auth.currentUser;
    if (user) {
        try {
            const snap = await getDocs(collection(db, "users", user.uid, "history"));
            for (const docSnap of snap.docs) {
                await deleteDoc(docSnap.ref);
            }
        } catch (err) {
            // Error clearing history in Firestore
        }
    }
};


window.redirectToPlaylistPage = function (playlistId, title, thumbnail) {
    saveToLectureHistory(title, playlistId, thumbnail);
    window.location.href = `playlist.html?playlistId=${playlistId}`;
};


window.savePlaylist = async function (title, id) {
    try {
        const decodedTitle = decodeURIComponent(title);
        const playlists = JSON.parse(localStorage.getItem("savedPlaylists")) || [];

        if (!playlists.some(p => p.id === id)) {
            playlists.push({ title: decodedTitle, id, savedAt: Date.now() });
            localStorage.setItem("savedPlaylists", JSON.stringify(playlists));
            showNotification(`Playlist "${decodedTitle}" saved!`, "success");
        } else {
            showNotification(`"${decodedTitle}" is already saved.`, "info");
        }

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
};

// Helper functions
function saveToLectureHistory(title, id, thumbnailUrl = null) {
    // Only save playlist-type IDs (not individual videos)
    if (!id || id.length <= 11 || (!id.startsWith("PL") && !id.startsWith("UU") && !id.startsWith("FL"))) {
        // Skipped saving non-playlist item to history
        return;
    }

    const history = JSON.parse(localStorage.getItem("lectureHistory")) || [];
    const thumbnail = thumbnailUrl || 'https://via.placeholder.com/120x70?text=Playlist';

    const existing = history.find(h => h.id === id);
    if (!existing) {
        history.unshift({ title, id, thumbnail, playedAt: Date.now() });
        localStorage.setItem("lectureHistory", JSON.stringify(history));
        updateLectureHistory();
    }
}


function updateLectureHistory() {
    const historyDiv = document.getElementById("lectureHistory");
    const lectureHistory = JSON.parse(localStorage.getItem("lectureHistory")) || [];

    if (!historyDiv) return;

    if (lectureHistory.length === 0) {
        historyDiv.innerHTML = `
            <div style="text-align: center; padding: 4rem; color: var(--text-muted);">
                <i class="fas fa-ghost fa-3x" style="margin-bottom: 1rem; opacity: 0.5;"></i>
                <p>No history found yet. Start exploring playlists to see them here!</p>
            </div>`;
        return;
    }

    historyDiv.innerHTML = lectureHistory.map((item, index) => {
        const safeTitle = item.title.replace(/'/g, "\\'").replace(/"/g, '\\"');
        return `
        <div class="history-item" style="background: var(--surface); backdrop-filter: blur(8px); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.5rem; display: flex; gap: 1.5rem; transition: var(--transition); box-shadow: var(--shadow);">
            <div class="history-thumb-wrapper" style="width: 160px; aspect-ratio: 16/9; border-radius: var(--radius); overflow: hidden; flex-shrink: 0; box-shadow: var(--shadow-sm);">
                <img src="${item.thumbnail}" 
                     alt="${item.title}" 
                     style="width: 100%; height: 100%; object-fit: cover;"
                     onerror="this.src='https://via.placeholder.com/160x90?text=No+Image'">
            </div>
            <div class="history-info" style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
                <p class="history-title" style="font-weight: 700; color: var(--text); font-size: 1.1rem; margin-bottom: 0.75rem;">${item.title}</p>
                <div class="history-actions" style="display: flex; gap: 0.75rem;">
                    <button class="btn-primary" style="padding: 0.5rem 1rem;" onclick="redirectToPlaylistPage('${item.id}', '${safeTitle}')">
                        <i class="fas fa-play"></i> Resume
                    </button>
                    <button class="btn-secondary" style="padding: 0.5rem 1rem;" onclick="savePlaylist('${safeTitle}', '${item.id}')">
                        <i class="fas fa-bookmark"></i> Save
                    </button>
                    <button class="btn-ghost" style="padding: 0.5rem 1rem; color: #ef4444;" onclick="removeLectureHistory(${index})">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>
        </div>
        `;
    }).join("");
}



// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
    updateLectureHistory();

    const clearButton = document.querySelector(".clear-button");
    if (clearButton) {
        clearButton.addEventListener("click", clearAllLectureHistory);
    }
});