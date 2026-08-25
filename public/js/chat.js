/**
 * ChatNest Core Chat Application Script
 */

document.addEventListener('DOMContentLoaded', () => {
  // Check Authentication
  const token = getAuthToken();
  if (!token) {
    window.location.href = 'index.html';
    return;
  }

  // Application State
  let activeConversationId = null;
  let conversations = [];
  let currentMessages = [];
  let isStreaming = false;
  let speechRecognition = null;
  let isListening = false;
  let currentAttachment = null;
  let isWebSearchActive = false;

  // DOM Element References
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const threadListEl = document.getElementById('threadList');
  const threadSearchInput = document.getElementById('threadSearch');
  const newChatBtn = document.getElementById('newChatBtn');
  const personaSelect = document.getElementById('personaSelect');
  const currentChatTitle = document.getElementById('currentChatTitle');
  const activePersonaBadge = document.getElementById('activePersonaBadge');
  const webSearchToggleBtn = document.getElementById('webSearchToggleBtn');
  const deleteThreadBtn = document.getElementById('deleteThreadBtn');
  const chatLog = document.getElementById('chatLog');
  const emptyState = document.getElementById('emptyState');
  const typingIndicator = document.getElementById('typingIndicator');
  const chatForm = document.getElementById('chatForm');
  const userInput = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  const voiceBtn = document.getElementById('voiceBtn');
  const attachBtn = document.getElementById('attachBtn');
  const cameraBtn = document.getElementById('cameraBtn');
  const fileInput = document.getElementById('fileInput');
  const cameraInput = document.getElementById('cameraInput');
  const attachmentPreview = document.getElementById('attachmentPreview');
  const attachIcon = document.getElementById('attachIcon');
  const attachName = document.getElementById('attachName');
  const removeAttachBtn = document.getElementById('removeAttachBtn');
  const userNameEl = document.getElementById('userName');
  const userEmailEl = document.getElementById('userEmail');
  const userAvatarEl = document.getElementById('userAvatar');
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const exportChatBtn = document.getElementById('exportChatBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  // Configure Marked Markdown Renderer
  if (window.marked) {
    marked.setOptions({
      breaks: true,
      gfm: true,
      highlight: function (code, lang) {
        if (window.hljs && lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang }).value;
          } catch (e) {}
        }
        return window.hljs ? hljs.highlightAuto(code).value : code;
      }
    });
  }

  // Initialize App
  init();

  async function init() {
    setupUserProfile();
    setupEventListeners();
    setupTheme();
    setupVoiceRecognition();
    setupDragAndDrop();
    await loadConversations();

    // Auto-create initial chat if none exists
    if (conversations.length === 0) {
      await createNewConversation();
    } else {
      selectConversation(conversations[0]._id);
    }
  }

  // User Profile Setup
  function setupUserProfile() {
    const user = getStoredUser();
    if (user) {
      userNameEl.textContent = user.name || 'User';
      userEmailEl.textContent = user.email || '';
      userAvatarEl.textContent = (user.name || 'U').charAt(0).toUpperCase();
    } else {
      // Fetch profile from backend
      fetchWithAuth('/auth/me')
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setStoredUser(data.user);
            userNameEl.textContent = data.user.name;
            userEmailEl.textContent = data.user.email;
            userAvatarEl.textContent = data.user.name.charAt(0).toUpperCase();
          }
        });
    }
  }

  // Theme Handler
  function setupTheme() {
    const savedTheme = localStorage.getItem('chatnest_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
  }

  function updateThemeIcon(theme) {
    const sunIcon = document.getElementById('themeIconSun');
    const moonIcon = document.getElementById('themeIconMoon');
    if (theme === 'light') {
      sunIcon?.classList.remove('hidden');
      moonIcon?.classList.add('hidden');
    } else {
      sunIcon?.classList.add('hidden');
      moonIcon?.classList.remove('hidden');
    }
  }

  themeToggleBtn?.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('chatnest_theme', newTheme);
    updateThemeIcon(newTheme);
  });

  // Setup Event Listeners
  function setupEventListeners() {
    // Mobile sidebar toggle
    mobileMenuBtn?.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      sidebarOverlay.classList.toggle('active');
    });

    sidebarOverlay?.addEventListener('click', () => {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('active');
    });

    // New Chat Button
    newChatBtn?.addEventListener('click', () => createNewConversation());

    // Delete Thread Button
    deleteThreadBtn?.addEventListener('click', () => {
      if (activeConversationId && confirm('Are you sure you want to delete this conversation thread?')) {
        deleteConversation(activeConversationId);
      }
    });

    // Persona Selector Change
    personaSelect?.addEventListener('change', async (e) => {
      const newPersona = e.target.value;
      activePersonaBadge.textContent = getPersonaLabel(newPersona);
      if (activeConversationId) {
        await fetchWithAuth(`/conversations/${activeConversationId}`, {
          method: 'PATCH',
          body: JSON.stringify({ persona: newPersona })
        });
      }
    });

    // Web Search Toggle Handler
    webSearchToggleBtn?.addEventListener('click', () => {
      isWebSearchActive = !isWebSearchActive;
      webSearchToggleBtn.classList.toggle('active', isWebSearchActive);
      showToast(`Real-Time Web Search: ${isWebSearchActive ? 'ENABLED 🌐' : 'DISABLED 🔒'}`);
    });

    // File & Camera Attachment Handlers
    attachBtn?.addEventListener('click', () => fileInput?.click());
    cameraBtn?.addEventListener('click', () => cameraInput?.click());

    fileInput?.addEventListener('change', handleFileSelected);
    cameraInput?.addEventListener('change', handleFileSelected);

    removeAttachBtn?.addEventListener('click', () => clearAttachment());

    // Search filter threads
    threadSearchInput?.addEventListener('input', (e) => {
      renderThreadList(e.target.value.toLowerCase());
    });

    // Auto-resizing Textarea & Submit
    userInput?.addEventListener('input', () => {
      userInput.style.height = 'auto';
      userInput.style.height = Math.min(userInput.scrollHeight, 180) + 'px';
    });

    userInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm.dispatchEvent(new Event('submit'));
      }
    });

    // Send Message Submit
    chatForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = userInput.value.trim();
      if ((!text && !currentAttachment) || isStreaming) return;
      sendMessage(text || 'Analyze this attachment:');
    });

    // Starter Prompt Cards
    document.querySelectorAll('.starter-card').forEach(card => {
      card.addEventListener('click', () => {
        const prompt = card.getAttribute('data-prompt');
        if (prompt) {
          userInput.value = prompt;
          chatForm.dispatchEvent(new Event('submit'));
        }
      });
    });

    // Export Chat
    exportChatBtn?.addEventListener('click', () => exportConversation());

    // Logout Button
    logoutBtn?.addEventListener('click', () => {
      if (confirm('Log out of ChatNest?')) {
        clearAuthToken();
        window.location.href = 'index.html';
      }
    });
  }

  // Handle File/Photo Selection
  function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    processSelectedFile(file);
  }

  function processSelectedFile(file) {
    if (!file) return;

    const reader = new FileReader();
    const isImage = file.type.startsWith('image/');
    const extension = (file.name.split('.').pop() || '').toLowerCase();

    let docIcon = '📄';
    let docType = 'doc';

    if (isImage) {
      docIcon = '🖼️';
      docType = 'image';
    } else if (extension === 'pdf') {
      docIcon = '📕';
    } else if (extension === 'docx' || extension === 'doc') {
      docIcon = '📝';
    } else if (['csv', 'xlsx', 'json'].includes(extension)) {
      docIcon = '📊';
    } else if (['js', 'py', 'ts', 'html', 'css', 'cpp', 'c', 'java', 'sql', 'xml'].includes(extension)) {
      docIcon = '💻';
    }

    reader.onload = (event) => {
      const dataUrl = event.target.result;
      const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const isPlainText = ['txt', 'md', 'csv', 'json', 'js', 'py', 'html', 'css', 'xml', 'cpp', 'c', 'java', 'sql'].includes(extension);

      if (isPlainText) {
        const textReader = new FileReader();
        textReader.onload = (tEvent) => {
          currentAttachment = {
            type: 'doc',
            name: file.name,
            mimeType: file.type || 'text/plain',
            base64Data,
            text: tEvent.target.result,
            size: formatBytes(file.size)
          };
          showAttachmentPreview(docIcon, file.name, formatBytes(file.size));
        };
        textReader.readAsText(file);
      } else {
        currentAttachment = {
          type: docType,
          name: file.name,
          mimeType: file.type || (extension === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
          base64Data,
          size: formatBytes(file.size)
        };
        showAttachmentPreview(docIcon, file.name, formatBytes(file.size));
      }
    };
    reader.readAsDataURL(file);
  }

  function setupDragAndDrop() {
    const dropzoneOverlay = document.getElementById('dropzoneOverlay');
    if (!dropzoneOverlay) return;

    let dragCounter = 0;

    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        dropzoneOverlay.classList.remove('hidden');
      }
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        dropzoneOverlay.classList.add('hidden');
      }
    });

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      dropzoneOverlay.classList.add('hidden');

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processSelectedFile(e.dataTransfer.files[0]);
      }
    });
  }

  function showAttachmentPreview(icon, name, sizeStr = '') {
    if (attachIcon) attachIcon.textContent = icon;
    if (attachName) attachName.textContent = sizeStr ? `${name} (${sizeStr})` : name;
    attachmentPreview?.classList.remove('hidden');
    showToast(`Attached: ${name}`);
  }

  function clearAttachment() {
    currentAttachment = null;
    if (fileInput) fileInput.value = '';
    if (cameraInput) cameraInput.value = '';
    attachmentPreview?.classList.add('hidden');
  }

  // Load All Conversations
  async function loadConversations() {
    try {
      const res = await fetchWithAuth('/conversations');
      const data = await res.json();
      if (data.success) {
        conversations = data.conversations;
        renderThreadList();
      }
    } catch (e) {
      console.error('Error loading conversations:', e);
    }
  }

  // Render Thread List in Sidebar
  function renderThreadList(filterText = '') {
    threadListEl.innerHTML = '';

    const filtered = conversations.filter(c => c.title.toLowerCase().includes(filterText));

    if (filtered.length === 0) {
      threadListEl.innerHTML = `<div class="sidebar-label" style="text-align:center; margin-top:1rem;">No chats found</div>`;
      return;
    }

    filtered.forEach(c => {
      const item = document.createElement('div');
      item.className = `thread-item ${c._id === activeConversationId ? 'active' : ''}`;
      item.innerHTML = `
        <span class="thread-title">${escapeHtml(c.title)}</span>
        <button class="thread-delete-icon" title="Delete thread" data-id="${c._id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.thread-delete-icon')) {
          e.stopPropagation();
          deleteConversation(c._id);
        } else {
          selectConversation(c._id);
          sidebar.classList.remove('open');
          sidebarOverlay.classList.remove('active');
        }
      });

      threadListEl.appendChild(item);
    });
  }

  // Create New Conversation Thread
  async function createNewConversation() {
    try {
      const currentPersona = personaSelect ? personaSelect.value : 'general';
      const res = await fetchWithAuth('/conversations', {
        method: 'POST',
        body: JSON.stringify({ title: 'New Chat', persona: currentPersona })
      });
      const data = await res.json();
      if (data.success) {
        conversations.unshift(data.conversation);
        renderThreadList();
        selectConversation(data.conversation._id);
      }
    } catch (e) {
      console.error('Error creating conversation:', e);
      showToast('Could not create new thread', 'danger');
    }
  }

  // Select Conversation Thread
  async function selectConversation(id) {
    activeConversationId = id;
    renderThreadList();

    const targetConv = conversations.find(c => c._id === id);
    if (targetConv) {
      currentChatTitle.textContent = targetConv.title;
      personaSelect.value = targetConv.persona || 'general';
      activePersonaBadge.textContent = getPersonaLabel(targetConv.persona);
      deleteThreadBtn.classList.remove('hidden');
    }

    // Load Messages
    chatLog.innerHTML = '<div class="thread-skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div></div>';

    try {
      const res = await fetchWithAuth(`/conversations/${id}/messages`);
      const data = await res.json();
      if (data.success) {
        currentMessages = data.messages;
        renderMessageLog();
      }
    } catch (e) {
      console.error('Error loading thread messages:', e);
    }
  }

  // Delete Conversation
  async function deleteConversation(id) {
    try {
      const res = await fetchWithAuth(`/conversations/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        conversations = conversations.filter(c => c._id !== id);
        showToast('Thread deleted');
        if (activeConversationId === id) {
          if (conversations.length > 0) {
            selectConversation(conversations[0]._id);
          } else {
            await createNewConversation();
          }
        } else {
          renderThreadList();
        }
      }
    } catch (e) {
      showToast('Failed to delete thread', 'danger');
    }
  }

  // Render Full Message History
  function renderMessageLog() {
    chatLog.innerHTML = '';

    if (currentMessages.length === 0) {
      chatLog.appendChild(emptyState);
      return;
    }

    currentMessages.forEach(msg => {
      appendMessageBubble(msg.role, msg.content, msg.createdAt, false);
    });

    scrollToBottom();
  }

  // Append Single Message Bubble
  function appendMessageBubble(role, content, timestamp = new Date(), isLiveStream = false) {
    if (emptyState.parentNode === chatLog) {
      chatLog.removeChild(emptyState);
    }

    const isUser = role === 'user';
    const row = document.createElement('div');
    row.className = `message-row ${isUser ? 'user-row' : 'assistant-row'}`;

    const avatarHtml = isUser
      ? `<div class="bubble-avatar user-avatar-bubble">${(getStoredUser()?.name || 'U').charAt(0).toUpperCase()}</div>`
      : `<div class="bubble-avatar assistant-avatar">🤖</div>`;

    const formattedTime = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    row.innerHTML = `
      ${avatarHtml}
      <div class="message-content-wrapper">
        <div class="message-bubble ${isUser ? 'user-bubble' : 'assistant-bubble'} ${isLiveStream ? 'streaming-cursor' : ''}">
          ${isUser ? renderUserBubbleContent(content) : parseMarkdown(content)}
        </div>
        <div class="message-timestamp">${formattedTime}</div>
        ${!isUser && !isLiveStream ? `
          <div class="message-actions">
            <button class="message-action-btn copy-msg-btn" title="Copy response text">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span>Copy</span>
            </button>
            <button class="message-action-btn regen-btn" title="Regenerate response">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              <span>Regenerate</span>
            </button>
          </div>
        ` : ''}
      </div>
    `;

    // Attach Copy Message Action
    const copyBtn = row.querySelector('.copy-msg-btn');
    copyBtn?.addEventListener('click', () => {
      navigator.clipboard.writeText(content);
      showToast('Copied message to clipboard');
    });

    // Attach Regenerate Action
    const regenBtn = row.querySelector('.regen-btn');
    regenBtn?.addEventListener('click', () => {
      const lastUserMsg = [...currentMessages].reverse().find(m => m.role === 'user');
      if (lastUserMsg && !isStreaming) {
        sendMessage(lastUserMsg.content);
      }
    });

    chatLog.appendChild(row);
    attachCodeCopyListeners(row);

    if (!isLiveStream && window.hljs) {
      row.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
    }

    if (window.renderMathInElement) {
      try {
        renderMathInElement(row, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
            { left: '\\[', right: '\\]', display: true }
          ],
          throwOnError: false
        });
      } catch (e) {}
    }

    scrollToBottom();
    return row;
  }

  // Parse Markdown & Add Code Block Headers
  function parseMarkdown(text) {
    if (!window.marked) return escapeHtml(text);
    const html = marked.parse(text);

    // Wrap pre code blocks into customized code containers with language tags & copy buttons
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    tempDiv.querySelectorAll('pre').forEach(pre => {
      const code = pre.querySelector('code');
      let lang = 'code';
      if (code && code.className) {
        const match = code.className.match(/language-(\w+)/);
        if (match) lang = match[1];
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';
      wrapper.innerHTML = `
        <div class="code-header">
          <span>${lang}</span>
          <button class="copy-code-btn" type="button">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>Copy Code</span>
          </button>
        </div>
      `;

      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);
    });

    return tempDiv.innerHTML;
  }

  // Code Block Copy Button Listener
  function attachCodeCopyListeners(parent) {
    parent.querySelectorAll('.copy-code-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const codeText = btn.closest('.code-block-wrapper').querySelector('code')?.innerText;
        if (codeText) {
          navigator.clipboard.writeText(codeText);
          const btnSpan = btn.querySelector('span');
          const orig = btnSpan.textContent;
          btnSpan.textContent = 'Copied!';
          showToast('Code copied to clipboard');
          setTimeout(() => btnSpan.textContent = orig, 2000);
        }
      });
    });
  }

  // Send Message with SSE Stream Reader
  async function sendMessage(text) {
    if (!activeConversationId || isStreaming) return;

    isStreaming = true;
    sendBtn.disabled = true;
    userInput.value = '';
    userInput.style.height = 'auto';

    // Extract attachment copy for request
    const attachmentToSend = currentAttachment;
    clearAttachment();

    // 1. Render User Bubble Immediately
    let userBubbleContent = text;
    if (attachmentToSend) {
      userBubbleContent = `[Attached: ${attachmentToSend.name}]\n${text}`;
    }
    appendMessageBubble('user', userBubbleContent, new Date());
    currentMessages.push({ role: 'user', content: userBubbleContent, createdAt: new Date() });

    // 2. Show Typing Pulse
    typingIndicator.classList.remove('hidden');
    scrollToBottom();

    // 3. Initiate SSE Streaming Request
    try {
      const response = await fetch(`/api/chat/${activeConversationId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify({
          message: text,
          persona: personaSelect.value,
          attachment: attachmentToSend,
          webSearch: isWebSearchActive
        })
      });

      typingIndicator.classList.add('hidden');

      if (!response.ok) {
        let errorMsg = 'Streaming failed';
        try {
          const errData = await response.json();
          errorMsg = errData.error || errorMsg;
        } catch (e) {
          try {
            const errText = await response.text();
            errorMsg = errText || errorMsg;
          } catch (tErr) {}
        }
        showToast(errorMsg, 'danger');
        isStreaming = false;
        sendBtn.disabled = false;
        return;
      }

      // Create live AI message row
      let accumulatedText = '';
      const aiRow = appendMessageBubble('assistant', '', new Date(), true);
      const bubbleEl = aiRow.querySelector('.assistant-bubble');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6).trim();
          if (dataStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.meta) {
              // Update thread title
              currentChatTitle.textContent = parsed.meta.title;
              const targetConv = conversations.find(c => c._id === parsed.meta.conversationId);
              if (targetConv) targetConv.title = parsed.meta.title;
              renderThreadList();
            }
            if (parsed.token !== undefined) {
              accumulatedText += parsed.token;
              bubbleEl.innerHTML = parseMarkdown(accumulatedText);
              attachCodeCopyListeners(aiRow);
              scrollToBottom();
            }
          } catch (e) {
            // Ignore partial SSE JSON frames until complete
          }
        }
      }

      // Remove streaming cursor styling & highlight code & math
      bubbleEl.classList.remove('streaming-cursor');
      if (window.hljs) {
        aiRow.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
      }
      if (window.renderMathInElement) {
        try {
          renderMathInElement(aiRow, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '$', right: '$', display: false },
              { left: '\\(', right: '\\)', display: false },
              { left: '\\[', right: '\\]', display: true }
            ],
            throwOnError: false
          });
        } catch (e) {}
      }

      currentMessages.push({ role: 'assistant', content: accumulatedText, createdAt: new Date() });

    } catch (error) {
      console.error('Streaming request error:', error);
      typingIndicator.classList.add('hidden');
      showToast('Network error during streaming', 'danger');
    } finally {
      isStreaming = false;
      sendBtn.disabled = false;
    }
  }

  // Voice Input Speech Recognition Setup
  function setupVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      voiceBtn?.classList.add('hidden');
      return;
    }

    speechRecognition = new SpeechRecognition();
    speechRecognition.continuous = false;
    speechRecognition.interimResults = false;
    speechRecognition.lang = 'en-US';

    speechRecognition.onstart = () => {
      isListening = true;
      voiceBtn.classList.add('listening');
      showToast('Listening... Speak now');
    };

    speechRecognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      userInput.value += (userInput.value ? ' ' : '') + transcript;
      userInput.style.height = Math.min(userInput.scrollHeight, 180) + 'px';
    };

    speechRecognition.onend = () => {
      isListening = false;
      voiceBtn.classList.remove('listening');
    };

    speechRecognition.onerror = (e) => {
      console.error('Speech recognition error:', e.error);
      isListening = false;
      voiceBtn.classList.remove('listening');
      showToast('Voice recognition error', 'danger');
    };

    voiceBtn?.addEventListener('click', () => {
      if (isListening) {
        speechRecognition.stop();
      } else {
        speechRecognition.start();
      }
    });
  }

  // Export Conversation to TXT/Markdown
  function exportConversation() {
    if (!currentMessages || currentMessages.length === 0) {
      showToast('No chat history to export', 'info');
      return;
    }

    let exportContent = `# ChatNest Conversation Export: ${currentChatTitle.textContent}\n`;
    exportContent += `Export Date: ${new Date().toLocaleString()}\n\n---\n\n`;

    currentMessages.forEach(m => {
      const sender = m.role === 'user' ? 'USER' : 'CHATNEST AI';
      exportContent += `### [${sender}] (${new Date(m.createdAt).toLocaleTimeString()})\n${m.content}\n\n`;
    });

    const blob = new Blob([exportContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ChatNest_${currentChatTitle.textContent.replace(/[^a-z0-9]/gi, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported conversation as Markdown!');
  }

  // Helper Utils
  function scrollToBottom() {
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function getPersonaLabel(key) {
    const map = {
      general: 'General',
      coding: 'Coding Expert',
      study: 'Study Tutor',
      creative: 'Creative',
      concise: 'Rapid Concise',
      uncensored: 'Uncensored AI'
    };
    return map[key] || 'General';
  }

  function formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  function renderUserBubbleContent(content) {
    if (!content) return '';
    const match = content.match(/^\[Attached:\s*([^\]]+)\](?:\n\[DOCUMENT CONTENT:[\s\S]*?\[END DOCUMENT\])?(?:\n\n([\s\S]*))?$/i);
    if (match) {
      const fileName = match[1];
      let userText = (match[2] || content.replace(/^\[Attached:[^\]]+\]/, '')).replace(/\[DOCUMENT CONTENT:[\s\S]*?\[END DOCUMENT\]/gi, '').trim();
      const ext = (fileName.split('.').pop() || '').toLowerCase();
      let docIcon = '📄';
      if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) docIcon = '🖼️';
      else if (ext === 'pdf') docIcon = '📕';
      else if (ext === 'docx' || ext === 'doc') docIcon = '📝';
      else if (['csv', 'xlsx', 'json'].includes(ext)) docIcon = '📊';
      else if (['js', 'py', 'ts', 'html', 'css', 'cpp', 'c', 'java', 'sql', 'xml'].includes(ext)) docIcon = '💻';

      return `
        <div class="user-attachment-card">
          <div class="attach-card-icon">${docIcon}</div>
          <div class="attach-card-details">
            <div class="attach-card-name">${escapeHtml(fileName)}</div>
            <div class="attach-card-sub">Document Attached &amp; Analyzed</div>
          </div>
        </div>
        ${userText ? `<div class="user-text-after-attachment">${escapeHtml(userText)}</div>` : ''}
      `;
    }
    return escapeHtml(content);
  }

  function escapeHtml(str) {
    return (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
});
