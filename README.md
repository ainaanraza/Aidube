# Your Classroom Project

An AI-powered educational platform that enhances your YouTube learning experience. This application turns standard video playlists into interactive classrooms with features like auto-generated notes, summaries, quizzes, and personalized learning roadmaps.

## 🚀 Features

*   **Smart Playlist Viewer**: Watch YouTube playlists in a focused environment without distractions.
*   **AI Study Aids**:
    *   **Summaries**: Instantly generate concise summaries of video content using Gemini AI.
    *   **Complete Notes**: Create detailed, formatted study notes from video transcripts.
    *   **PDF Export**: Download your notes and summaries as PDF files.
*   **Interactive Quizzes**: Generate custom tests based on the video content to verify your understanding.
*   **Learning Roadmaps**: Generate personalized step-by-step learning paths for any topic.
*   **Dashboard**:
    *   Save your favorite playlists.
    *   Track your watch history.
    *   Resume where you left off.
*   **User Accounts**: Sync your progress, saved playlists, and history across devices using Firebase Authentication.

## 🛠️ Technology Stack

*   **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES6+ Modules)
*   **AI & Data**:
    *   **Google Gemini API**: Powers the summarization, note-taking, and roadmap generation.
    *   **YouTube Data API v3**: Fetches playlist and video metadata.
*   **Backend & Persistence**:
    *   **Firebase Authentication**: User login and security.
    *   **Firebase Firestore**: Real-time database for saving user data.
*   **Utilities**:
    *   `jspdf`: For generating downloadable PDF files.

## 📦 Setup & Installation

1.  **Clone the repository**:
    ```bash
    git clone <repository-url>
    ```
2.  **Open the application**:
    Since this is a static web application, you can simply open `index.html` in your browser.
    *   *Recommended*: Use a local development server (e.g., Live Server in VS Code) for the best experience, especially with ES modules.

3.  **API Configuration**:
    *   The project requires API keys for **Firebase**, **YouTube Data API**, and **Google Gemini**.
    *   Check `js/firebase.js` and `js/utils.js` to configure your keys.

## 📂 Project Structure

*   `index.html` - Main dashboard.
*   `playlist.html` - Video player and study tools.
*   `roadmap.html` - AI roadmap generator.
*   `login.html` - Authentication page.
*   `js/` - Application logic (modules).
*   `css/` - Styling.

## 🤝 Contributing

Feel free to fork this project and submit pull requests for any enhancements or bug fixes.

