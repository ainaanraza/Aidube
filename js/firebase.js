// /js/firebase.js
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDFkjR_NuVsXkB13M7oVTzqWq-ukvtx5dU",
  authDomain: "aidube.firebaseapp.com",
  projectId: "aidube",
  storageBucket: "aidube.appspot.com", 
  messagingSenderId: "412680177345",
  appId: "1:412680177345:web:32d40895fbaf8d28d93640",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope("https://www.googleapis.com/auth/youtube.readonly");

export const db = getFirestore(app);
