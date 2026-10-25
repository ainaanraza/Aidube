// /js/firebase.js
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, signInWithPopup, updateProfile, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAC5qK3m-FLkntN5qulQOm1gHRuBVTBVFk",
  authDomain: "aidube-d5791.firebaseapp.com",
  projectId: "aidube-d5791",
  storageBucket: "aidube-d5791.firebasestorage.app",
  messagingSenderId: "73913173806",
  appId: "1:73913173806:web:ecfe873c0ce15ed5339cbf",
  measurementId: "G-JJ0XB4BFWQ"
};


const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, signInWithPopup, updateProfile, sendPasswordResetEmail };
// googleProvider.addScope("https://www.googleapis.com/auth/youtube.readonly"); // Removed to prevent "Sensitive Info" warning.

export const db = getFirestore(app);

import { getAnalytics, setUserId, logEvent, setAnalyticsCollectionEnabled } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-analytics.js";
export const analytics = getAnalytics(app);
setAnalyticsCollectionEnabled(analytics, true);
export { setUserId, logEvent };

// Enable analytics collection (optional, enabled by default)
// analytics.setAnalyticsCollectionEnabled(true);

// Firebase initialized successfully
