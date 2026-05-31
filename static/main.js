/* ============================================================
   INTERVIEW BOT — MAIN JS
   ============================================================ */

// State
let sessionId = null;
let timerInterval = null;
let timerSeconds = 0;
let roundCount = 0;
let isWaiting = false;
let pdfFile = null;

// ── DOM helpers ──────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`${name}-screen`).classList.add('active');
}

// ── Setup Screen Init ────────────────────────────────────────
function initSetup() {
  const jdInput = $('jd-input');
  const jdCount = $('jd-count');

  jdInput.addEventListener('input', () => {
    jdCount.textContent = jdInput.value.length + ' 字';
  });

  // PDF Upload
  const uploadZone = $('upload-zone');
  const pdfInput = $('pdf-input');

  uploadZone.addEventListener('click', () => pdfInput.click());

  pdfInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handlePdfFile(file);
  });

  // Drag & Drop
  uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
  });

  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      handlePdfFile(file);
    } else {
      showUploadStatus('⚠ 請上傳 PDF 格式檔案', 'error');
    }
  });
}

function handlePdfFile(file) {
  pdfFile = file;
  showUploadStatus(`✓ 已載入：${file.name} (${(file.size / 1024).toFixed(0)} KB)`, 'success');
  $('resume-text-input').value = '';
  $('resume-text-input').placeholder = '已上傳 PDF，無需再輸入文字';
  $('resume-text-input').disabled = true;
}

function showUploadStatus(msg, type) {
  const el = $('upload-status');
  el.textContent = msg;
  el.style.color = type === 'success' ? 'var(--green)' : 'var(--red)';
}

// ── Start Interview ──────────────────────────────────────────
async function startInterview() {
  const jd = $('jd-input').value.trim();
  const resumeText = $('resume-text-input').value.trim();

  if (!jd) {
    alert('請輸入職位描述 (JD)');
    $('jd-input').focus();
    return;
  }

  if (!pdfFile && !resumeText) {
    alert('請上傳履歷 PDF 或輸入履歷文字');
    return;
  }

  // Show loading
  $('start-btn').disabled = true;
  $('loading-overlay').classList.remove('hidden');
  setLoadingText('正在分析職缺與履歷資料...');

  setTimeout(() => setLoadingText('AI 面試官正在準備問題...'), 2000);
  setTimeout(() => setLoadingText('即將開始面試，請稍候...'), 4000);

  try {
    const formData = new FormData();
    formData.append('jd_text', jd);

    if (pdfFile) {
      formData.append('resume_pdf', pdfFile);
    } else {
      formData.append('resume_text', resumeText);
    }

    const res = await fetch('/api/start', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || '啟動失敗');

    sessionId = data.session_id;

    // Switch to interview screen
    $('loading-overlay').classList.add('hidden');
    showScreen('interview');
    initInterviewScreen();
    appendAIMessage(data.message);

  } catch (err) {
    $('loading-overlay').classList.add('hidden');
    $('start-btn').disabled = false;
    alert('啟動面試失敗：' + err.message);
  }
}

function setLoadingText(text) {
  $('loading-text').textContent = text;
}

// ── Interview Screen ─────────────────────────────────────────
function initInterviewScreen() {
  clearMessages();
  roundCount = 0;
  timerSeconds = 0;
  updateRoundCount();

  // Start timer
  timerInterval = setInterval(() => {
    timerSeconds++;
    updateTimer();
  }, 1000);

  // Focus input
  setTimeout(() => $('chat-input').focus(), 300);
}

function updateTimer() {
  const m = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
  const s = String(timerSeconds % 60).padStart(2, '0');
  $('timer-display').textContent = `${m}:${s}`;
}

function updateRoundCount() {
  $('round-count').textContent = roundCount;
}

function clearMessages() {
  $('messages').innerHTML = '';
}

// ── Message Functions ────────────────────────────────────────
function appendAIMessage(text) {
  const container = $('messages');
  const div = document.createElement('div');
  div.className = 'message ai';
  div.innerHTML = `
    <div class="msg-avatar">HR</div>
    <div class="msg-content">
      <div class="msg-name">AI 面試官</div>
      <div class="msg-bubble">${formatText(text)}</div>
    </div>
  `;
  container.appendChild(div);
  scrollToBottom();
}

function appendUserMessage(text) {
  const container = $('messages');
  const div = document.createElement('div');
  div.className = 'message user';
  div.innerHTML = `
    <div class="msg-avatar">我</div>
    <div class="msg-content">
      <div class="msg-name">您的回答</div>
      <div class="msg-bubble">${escapeHtml(text)}</div>
    </div>
  `;
  container.appendChild(div);
  scrollToBottom();
}

function showTypingIndicator() {
  removeTypingIndicator();
  const container = $('messages');
  const div = document.createElement('div');
  div.className = 'message ai';
  div.id = 'typing-indicator';
  div.innerHTML = `
    <div class="msg-avatar">HR</div>
    <div class="msg-content">
      <div class="msg-name">AI 面試官</div>
      <div class="msg-bubble typing-bubble">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  container.appendChild(div);
  scrollToBottom();
}

function removeTypingIndicator() {
  const el = $('typing-indicator');
  if (el) el.remove();
}

function scrollToBottom() {
  const c = $('messages');
  c.scrollTop = c.scrollHeight;
}

// ── Send Message ─────────────────────────────────────────────
async function sendMessage() {
  if (isWaiting) return;

  const input = $('chat-input');
  const text = input.value.trim();

  if (!text) return;
  if (!sessionId) { alert('面試尚未開始'); return; }

  input.value = '';
  input.style.height = 'auto';
  isWaiting = true;
  $('send-btn').disabled = true;

  appendUserMessage(text);
  showTypingIndicator();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, message: text })
    });
    const data = await res.json();

    removeTypingIndicator();

    if (!res.ok) throw new Error(data.error || '回應失敗');

    roundCount++;
    updateRoundCount();
    appendAIMessage(data.message);

  } catch (err) {
    removeTypingIndicator();
    appendAIMessage(`⚠ 發生錯誤：${err.message}，請重試。`);
  } finally {
    isWaiting = false;
    $('send-btn').disabled = false;
    input.focus();
  }
}

function handleKeyDown(e) {
  // Ctrl+Enter to send
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ── Feedback ─────────────────────────────────────────────────
async function requestFeedback() {
  if (!sessionId) return;

  $('feedback-modal').classList.remove('hidden');
  $('feedback-content').innerHTML = `
    <div style="text-align:center; padding: 40px 20px;">
      <div class="loading-spinner" style="margin: 0 auto 16px;"></div>
      <p>AI 正在分析您的面試表現...</p>
    </div>
  `;

  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || '評估失敗');

    $('feedback-content').innerHTML = renderMarkdown(data.feedback);

  } catch (err) {
    $('feedback-content').innerHTML = `<p style="color:var(--red)">⚠ 生成評估失敗：${err.message}</p>`;
  }
}

function closeFeedback() {
  $('feedback-modal').classList.add('hidden');
}

// ── End Interview ────────────────────────────────────────────
function endInterview() {
  if (!confirm('確定要結束本次面試嗎？')) return;

  // Cleanup
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

  if (sessionId) {
    fetch('/api/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    }).catch(() => {});
    sessionId = null;
  }

  // Reset
  closeFeedback();
  $('jd-input').value = '';
  $('resume-text-input').value = '';
  $('resume-text-input').disabled = false;
  $('resume-text-input').placeholder = '將您的履歷文字貼在此處（教育背景、工作經歷、專案、技能等）';
  $('upload-status').textContent = '';
  $('jd-count').textContent = '0 字';
  pdfFile = null;
  $('pdf-input').value = '';
  $('start-btn').disabled = false;
  roundCount = 0;
  timerSeconds = 0;
  clearMessages();

  showScreen('setup');
}

// ── Helpers ──────────────────────────────────────────────────
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

function formatText(text) {
  // Basic markdown-like formatting for AI messages
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^(.+)$/, '<p>$1</p>');
}

function renderMarkdown(text) {
  // Render feedback markdown
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^(?!<[hul])(.+)$/gm, '<p>$1</p>');
}

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSetup();
  showScreen('setup');
});
