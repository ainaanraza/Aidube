import { auth, db } from "./firebase.js";
import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
import { showNotification } from "./utils.js";

document.addEventListener("DOMContentLoaded", () => {
    auth.onAuthStateChanged((user) => {
        if (user) {
            initAnalytics(user);
        } else {
            document.querySelector('.analytics-container').innerHTML = '<div style="text-align:center; padding: 4rem;"><h3>Please log in to view analytics.</h3></div>';
        }
    });
});

async function initAnalytics(user) {
    try {
        const creditsDoc = await getDoc(doc(db, "users", user.uid));
        const totalCredits = creditsDoc.exists() ? (creditsDoc.data().credits || 0) : 0;

        const videosSnapshot = await getDocs(collection(db, "users", user.uid, "completedVideos"));
        const completedVideos = videosSnapshot.docs.map(doc => doc.data());

        const testsSnapshot = await getDocs(collection(db, "users", user.uid, "testScores"));
        const testScores = testsSnapshot.docs.map(doc => doc.data());

        loadStats(totalCredits, completedVideos, testScores);
        renderCharts(completedVideos, testScores);
        renderBadges(totalCredits, completedVideos, testScores);
    } catch (e) {
        console.error("Error loading analytics data:", e);
    }
}

function loadStats(totalCredits, completedVideos, testScores) {

    document.getElementById("totalCredits").textContent = totalCredits;
    document.getElementById("videosWatched").textContent = completedVideos.length;
    document.getElementById("testsTaken").textContent = testScores.length;

    let avgScore = 0;
    if (testScores.length > 0) {
        let totalPercentage = testScores.reduce((acc, curr) => {
            return acc + (curr.score / curr.total);
        }, 0);
        avgScore = Math.round((totalPercentage / testScores.length) * 100);
    }

    document.getElementById("avgScore").textContent = `${avgScore}%`;

    // Learn & Earn Logic
    // Exchange rate: 1 point = $0.01
    const earnings = (totalCredits * 0.01).toFixed(2);
    document.getElementById("estimatedEarnings").textContent = `$${earnings}`;

    const redeemBtn = document.getElementById("redeemBtn");
    if (redeemBtn) {
        redeemBtn.onclick = () => {
            if (totalCredits < 100) {
                showNotification("You need a minimum of 100 credits to redeem. Keep learning!", "warning");
            } else {
                showNotification("Withdrawal feature coming soon! Your credits are safe.", "info");
            }
        };
    }
}

function renderCharts(completedVideos, testScores) {

    // Grouping by Date for Activity
    const activityData = {};
    completedVideos.forEach(v => {
        const dateStr = new Date(v.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        activityData[dateStr] = (activityData[dateStr] || 0) + 1;
    });

    // We'll fill in missing days for the last 7 days nicely if we wanted, or just show recorded days for simplicity
    const labels = Object.keys(activityData);
    const dataPoints = Object.values(activityData);

    const activityCtx = document.getElementById('activityChart').getContext('2d');
    new Chart(activityCtx, {
        type: 'line',
        data: {
            labels: labels.length ? labels : ['No Data'],
            datasets: [{
                label: 'Videos Watched',
                data: dataPoints.length ? dataPoints : [0],
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 3,
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } }
            }
        }
    });

    // Test Performance Chart
    const testLabels = testScores.map((t, i) => `Test ${i + 1}`);
    const testData = testScores.map(t => Math.round((t.score / t.total) * 100));

    const perfCtx = document.getElementById('performanceChart').getContext('2d');
    new Chart(perfCtx, {
        type: 'bar',
        data: {
            labels: testLabels.length ? testLabels : ['No Data'],
            datasets: [{
                label: 'Score %',
                data: testData.length ? testData : [0],
                backgroundColor: 'rgba(16, 185, 129, 0.6)',
                borderColor: '#10b981',
                borderWidth: 2,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true, max: 100 }
            }
        }
    });
}

function renderBadges(totalCredits, completedVideos, testScores) {

    const badgesData = [
        {
            id: 'first_lesson',
            title: 'First Step',
            icon: '<i class="fas fa-shoe-prints"></i>',
            reqMsg: 'Watch your first video lesson',
            isEarned: completedVideos.length >= 1
        },
        {
            id: 'scholar_10',
            title: 'Dedicated Learner',
            icon: '<i class="fas fa-book-reader"></i>',
            reqMsg: 'Watch 10 video lessons',
            isEarned: completedVideos.length >= 10
        },
        {
            id: 'perfect_score',
            title: 'A+ Student',
            icon: '<i class="fas fa-star"></i>',
            reqMsg: 'Get 100% on any assessment',
            isEarned: testScores.some(t => t.score === t.total)
        },
        {
            id: 'credit_master',
            title: 'Credit Hoarder',
            icon: '<i class="fas fa-piggy-bank"></i>',
            reqMsg: 'Accumulate 500 Credits',
            isEarned: totalCredits >= 500
        }
    ];

    const badgesHtml = badgesData.map(b => `
        <div class="badge-card ${b.isEarned ? 'earned' : ''}" title="${b.reqMsg}">
            <div class="badge-icon">${b.icon}</div>
            <h4>${b.title}</h4>
            <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem;">
                ${b.isEarned ? '<i class="fas fa-check-circle" style="color: #10b981;"></i> Unlocked' : 'Locked'}
            </p>
        </div>
    `).join("");

    document.getElementById("badgesGrid").innerHTML = badgesHtml;
}
