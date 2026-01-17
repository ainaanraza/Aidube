// Configuration
const YOUTUBE_API_KEYS = [
    "AIzaSyB8qZ_7Z7miBrUeo2cRDE6aPwyhe5TVCo8",
    "AIzaSyAJ3HiYC9gPEEv5w7AoGa4lGuap7bp-ulE",
    "AIzaSyDrdKBBnrBCPqHKkyR3DRHt7EIyf_-mq3U"
];

const GEMINI_API_KEYS = [
    "AIzaSyCxmH2scV8KDS3TTKju8YnRSQdsOjmbyMI",
    "AIzaSyAXh5mE52qyJuIyv8QjMpx6CRWQb363wZ0",
    "AIzaSyDzmaqaK8K-VQrdlfA2L8j3af6wZ06HH4w",
    "AIzaSyAcaoCV_IhsD61HrYWewecC0Mpeys0LrbE",
    "AIzaSyCokZX00LfxiJ6XSukz2Ajd9T6Zk-N_USo"
];

let currentYouTubeKeyIndex = 0;
let currentGeminiKeyIndex = 0;

export function getYouTubeApiKey() {
    return YOUTUBE_API_KEYS[currentYouTubeKeyIndex];
}

export function rotateYouTubeKey() {
    currentYouTubeKeyIndex = (currentYouTubeKeyIndex + 1) % YOUTUBE_API_KEYS.length;
    // Rotating YouTube API Key
}

export function getGeminiApiKey() {
    return GEMINI_API_KEYS[currentGeminiKeyIndex];
}

export function rotateGeminiKey() {
    currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % GEMINI_API_KEYS.length;
    // Rotating Gemini API Key
}

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
        <span>${message}</span>
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
