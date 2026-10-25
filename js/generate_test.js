// Simple test generator page script

async function generateUsingGemini(prompt, opts = {}) {
  const res = await fetch('/api/gemini', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      action: 'generate',
      prompt: prompt,
      maxTokens: opts.maxTokens || 1200,
      temperature: opts.temperature || 0.2
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.text || '';
}

function renderQuestions(raw) {
  const area = document.getElementById('testArea');
  area.innerHTML = '';
  // Attempt to parse questions if model returned numbered list
  const parts = raw.split(/\n\n|\r\n\r\n/).filter(Boolean);
  let qcount = 0;
  parts.forEach(p => {
    const lines = p.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    qcount++;
    const div = document.createElement('div');
    div.className = 'question';
    const title = document.createElement('h4');
    title.textContent = `Q${qcount}: ${lines[0].replace(/^\d+\.\s*/, '')}`;
    div.appendChild(title);
    // rest lines as choices
    const ul = document.createElement('ul');
    lines.slice(1).forEach(choice => {
      const li = document.createElement('li');
      li.textContent = choice.replace(/^[a-zA-Z]\)\s*/, '');
      ul.appendChild(li);
    });
    div.appendChild(ul);
    area.appendChild(div);
  });
  if (qcount === 0) area.innerHTML = '<div class="loading">Could not parse questions, here is the raw output:</div><pre>' + escapeHtml(raw) + '</pre>';
}

function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function generateTest() {
  const info = document.getElementById('videoInfo');
  info.textContent = 'Generating test...';
  const transcript = sessionStorage.getItem('aidube_video_transcript') || '';
  const videoId = sessionStorage.getItem('aidube_video_id') || new URLSearchParams(window.location.search).get('videoId');
  try {
    let prompt = `Create a 10-question multiple choice test (4 choices each) for the following video. Provide the question followed by choices labeled (A), (B), (C), (D) and on a separate line mark the correct answer with "Answer: <letter>". Use the transcript or description below:\n\nTRANSCRIPT:\n${transcript}`;
    const raw = await generateUsingGemini(prompt, { maxTokens: 1200 });
    renderQuestions(raw);
    info.textContent = `Test generated for video ${videoId}`;
  } catch (e) {
    // Test generation failed
    info.textContent = 'Test generation failed: ' + e.message;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const regen = document.getElementById('regenerateBtn');
  const back = document.getElementById('backBtn');
  regen.addEventListener('click', generateTest);
  back.addEventListener('click', () => { window.history.back(); });
  // Auto-run
  generateTest();
});
