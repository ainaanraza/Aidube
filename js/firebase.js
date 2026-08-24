// /js/firebase.js
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, signInWithPopup, updateProfile, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDFkjR_NuVsXkB13M7oVTzqWq-ukvtx5dU",
  authDomain: "aidube.firebaseapp.com",
  projectId: "aidube",
  storageBucket: "aidube.appspot.com", // ✅ must be .appspot.com
  messagingSenderId: "412680177345",
  appId: "1:412680177345:web:32d40895fbaf8d28d93640",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, signInWithPopup, updateProfile, sendPasswordResetEmail };
// googleProvider.addScope("https://www.googleapis.com/auth/youtube.readonly"); // Removed to prevent "Sensitive Info" warning.

export const db = getFirestore(app);

import { getAnalytics, setUserId, logEvent, setAnalyticsCollectionEnabled } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-analytics.js";
// export const analytics = getAnalytics(app);
// setAnalyticsCollectionEnabled(analytics, true);
export { setUserId, logEvent };

// Enable analytics collection (optional, enabled by default)
// analytics.setAnalyticsCollectionEnabled(true);

// Firebase initialized successfully
