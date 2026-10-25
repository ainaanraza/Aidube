import { auth, db } from "./firebase.js";
import { doc, getDoc, setDoc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

// Secure Backend API Helpers
const BACKEND_BASE = "";

/**
 * Calls the secure backend YouTube API endpoint
 * @param {string} action - 'searchPlaylists' | 'playlistItems' | 'videoDetails' | 'playlistDetails'
 * @param {object} params - query parameters or payload
 */
export async function callYouTubeApi(action, params = {}) {
    const url = new URL("/api/youtube", window.location.origin);
    url.searchParams.set("action", action);
    for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== null) {
            url.searchParams.set(key, String(val));
        }
    }

    const res = await fetch(url.toString(), {
        method: "GET",
        headers: { "Accept": "application/json" }
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `YouTube API error: ${res.status}`);
    }

    return await res.json();
}

/**
 * Calls the secure backend Gemini API endpoint
 * @param {string} action - 'generate' | 'test' | 'roadmap' | 'subtopics' | 'research'
 * @param {object} payload - action-specific parameters
 */
export async function callGeminiApi(action, payload = {}) {
    const res = await fetch("/api/gemini", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify({ action, ...payload })
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Gemini API error: ${res.status}`);
    }

    return await res.json();
}

// Deprecated legacy stubs to prevent breaking any third-party or uncaught calls
export function getYouTubeApiKey() { return null; }
export function rotateYouTubeKey() { }
export async function getGeminiApiKey() { return null; }
export function rotateGeminiKey() { }


// Validation
export function isValidPlaylistId(id) {
    return id && id.length > 11 && (id.startsWith('PL') || id.startsWith('UU') || id.startsWith('FL'));
}

// Helper function for retries
export async function retryOperation(operation, maxRetries = 3, delay = 2000, onRetry = null) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            if (i === maxRetries - 1) throw error; // Throw if last attempt failed

            // Only retry on 503, 429, or 403 (Quota Exceeded/Forbidden)
            if (error.message.includes('503') || error.message.includes('429') || error.message.includes('403')) {
                // Attempt failed. Retrying...

                if (onRetry) {
                    onRetry();
                }

                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Exponential backoff
            } else {
                throw error; // Throw other errors immediately
            }
        }
    }
}

export function showNotification(message, type = 'info') {
    // Remove existing notifications to prevent stacking too many
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(n => n.remove());

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;

    // Icon selection
    let iconClass = 'info-circle';
    if (type === 'success') iconClass = 'check-circle';
    if (type === 'error') iconClass = 'exclamation-circle';
    if (type === 'warning') iconClass = 'exclamation-triangle';

    notification.innerHTML = `
        <i class="fas fa-${iconClass}"></i>
        <span>${sanitizeHTML(message)}</span>
    `;

    document.body.appendChild(notification);

    // Trigger animation
    requestAnimationFrame(() => {
        notification.classList.add('active');
    });

    // Auto remove
    setTimeout(() => {
        notification.classList.remove('active');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300); // Wait for transition
    }, 3000);
}

// Quota Management
export async function checkQuota(type) {
    const user = auth.currentUser;
    if (!user) return false;

    const date = new Date().toISOString().split('T')[0];
    const docRef = doc(db, "users", user.uid, "daily_quotas", date);

    try {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            const count = data[type] || 0;
            if (count >= 3) {
                showNotification(`Quota hit: Daily limit of 3 ${type} generations reached.`, "warning");
                return false;
            }
        }
        return true;
    } catch (e) {
        // Error checking quota
        // Fail open if network error, or fail closed? 
        // Let's assume fail open strictly for check, but usually it's better to warn.
        return true;
    }
}

export async function incrementQuota(type) {
    const user = auth.currentUser;
    if (!user) return;

    const date = new Date().toISOString().split('T')[0];
    const docRef = doc(db, "users", user.uid, "daily_quotas", date);

    try {
        await setDoc(docRef, {
            [type]: increment(1),
            lastUpdated: Date.now()
        }, { merge: true });
    } catch (e) {
        // Error incrementing quota
    }
}

export function sanitizeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export async function awardCredits(amount, reason) {
    const user = auth.currentUser;
    showNotification(`Earned ${amount} Credits for ${reason}!`, "success");

    if (user) {
        try {
            const userRef = doc(db, "users", user.uid);
            await setDoc(userRef, {
                credits: increment(amount)
            }, { merge: true });

            // Log history to firestore for safe keeping
            const historyRef = doc(db, "users", user.uid, "creditHistory", `${Date.now()}`);
            await setDoc(historyRef, { amount, reason, timestamp: Date.now() });
        } catch (e) {
            console.error("Error saving credits", e);
        }
    }
}

export async function trackVideoCompletion(videoId, videoTitle, playlistId) {
    const user = auth.currentUser;
    if (user) {
        try {
            const docRef = doc(db, "users", user.uid, "completedVideos", videoId);
            await setDoc(docRef, {
                videoId, title: videoTitle, playlistId, completedAt: Date.now()
            }, { merge: true });
        } catch (e) { }
    }
}

// Global Time Tracker
function initTimeTracker() {
    // Read total minutes stored locally or default to 0
    let totalMinutes = parseInt(localStorage.getItem("totalMinutesSpent") || "0");
    let previousHours = Math.floor(totalMinutes / 60);

    setInterval(() => {
        totalMinutes += 1; // tick every minute
        localStorage.setItem("totalMinutesSpent", totalMinutes.toString());

        let currentHours = Math.floor(totalMinutes / 60);
        if (currentHours > previousHours) {
            // Reached a new hour
            awardCredits(1, `spending ${currentHours} hour(s) learning`);
            previousHours = currentHours;
        }
    }, 60 * 1000); // 1 minute
}

// Start tracking immediately
initTimeTracker();
