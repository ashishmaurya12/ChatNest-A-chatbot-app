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
  let isUserScrolledUp = false;

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
  const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');
  const emptyStateElement = document.getElementById('emptyState');
  const emptyStateTemplate = emptyStateElement ? emptyStateElement.cloneNode(true) : null;
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

  // Track User Manual Scroll Intent in Chat Log
  chatLog.addEventListener('scroll', () => {
    const distanceFromBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight;
    if (distanceFromBottom > 120) {
      isUserScrolledUp = true;
      scrollToBottomBtn?.classList.remove('hidden');
    } else {
      isUserScrolledUp = false;
      scrollToBottomBtn?.classList.add('hidden');
    }
  });

  scrollToBottomBtn?.addEventListener('click', () => {
    isUserScrolledUp = false;
    scrollToBottomBtn.classList.add('hidden');
    scrollToBottom(true);
  });
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
    setupSettingsModal();
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
      showToast(`Real-Time Web Search: ${isWebSearchActive ? 'ENABLED' : 'DISABLED'}`);
    });

    // File & Camera Attachment Handlers
    attachBtn?.addEventListener('click', () => fileInput?.click());
    
    // Live WebCam Camera Handlers
    const cameraModal = document.getElementById('cameraModal');
    const closeCameraBtn = document.getElementById('closeCameraBtn');
    const snapPhotoBtn = document.getElementById('snapPhotoBtn');
    const cameraVideo = document.getElementById('cameraVideo');
    const cameraCanvas = document.getElementById('cameraCanvas');
    let activeCameraStream = null;

    async function openLiveCamera() {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
          });
          activeCameraStream = stream;
          if (cameraVideo) {
            cameraVideo.srcObject = stream;
            cameraVideo.play();
          }
          cameraModal?.classList.remove('hidden');
          return;
        } catch (err) {
          console.warn('[WebCam Error]: Could not access camera via getUserMedia, falling back to file input:', err.message);
        }
      }
      // Fallback if WebCam permission is denied or device has no camera stream support
      cameraInput?.click();
    }

    function stopLiveCamera() {
      if (activeCameraStream) {
        activeCameraStream.getTracks().forEach(track => track.stop());
        activeCameraStream = null;
      }
      if (cameraVideo) {
        cameraVideo.srcObject = null;
      }
      cameraModal?.classList.add('hidden');
    }

    function captureCameraPhoto() {
      if (!cameraVideo || !cameraCanvas) return;
      const width = cameraVideo.videoWidth || 640;
      const height = cameraVideo.videoHeight || 480;

      cameraCanvas.width = width;
      cameraCanvas.height = height;

      const ctx = cameraCanvas.getContext('2d');
      ctx.drawImage(cameraVideo, 0, 0, width, height);

      const dataUrl = cameraCanvas.toDataURL('image/jpeg', 0.88);
      const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const fileName = `photo_${Date.now()}.jpg`;

      currentAttachment = {
        type: 'image',
        name: fileName,
        mimeType: 'image/jpeg',
        base64Data,
        size: 'Captured Photo'
      };

      showAttachmentPreview('🖼️', fileName, 'Captured Photo');
      stopLiveCamera();
    }

    cameraBtn?.addEventListener('click', () => openLiveCamera());
    closeCameraBtn?.addEventListener('click', () => stopLiveCamera());
    snapPhotoBtn?.addEventListener('click', () => captureCameraPhoto());
    cameraModal?.querySelector('.camera-modal-backdrop')?.addEventListener('click', () => stopLiveCamera());

    fileInput?.addEventListener('change', handleFileSelected);
    cameraInput?.addEventListener('change', handleFileSelected);

    removeAttachBtn?.addEventListener('click', () => clearAttachment());

    // Search filter threads (debounced for performance)
    let searchDebounceTimeout = null;
    threadSearchInput?.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimeout);
      searchDebounceTimeout = setTimeout(() => {
        renderThreadList(e.target.value.toLowerCase());
      }, 150);
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

    // Send Message Submit & Stop Button Click
    chatForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (isStreaming) {
        stopStreaming();
        return;
      }
      const text = userInput.value.trim();
      if (!text && !currentAttachment) return;
      sendMessage(text || 'Analyze this attachment:');
    });

    sendBtn?.addEventListener('click', (e) => {
      if (isStreaming) {
        e.preventDefault();
        stopStreaming();
      }
    });

    // Starter Prompt Cards
    attachStarterCardListeners(document);

    // Settings Modal Open Trigger (Account Profile Click & Header Settings)
    const userProfileEl = document.getElementById('userProfile');
    const headerSettingsBtn = document.getElementById('headerSettingsBtn');
    userProfileEl?.addEventListener('click', () => openSettingsModal());
    headerSettingsBtn?.addEventListener('click', () => openSettingsModal());

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

    let docIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    let docType = 'doc';

    if (isImage) {
      docIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
      docType = 'image';
    } else if (extension === 'pdf' || extension === 'docx' || extension === 'doc') {
      docIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    } else if (['js', 'py', 'ts', 'html', 'css', 'cpp', 'c', 'java', 'sql', 'xml'].includes(extension)) {
      docIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
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
    if (attachIcon) attachIcon.innerHTML = icon;
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

  // Render Thread List in Sidebar (uses DocumentFragment to prevent reflows)
  function renderThreadList(filterText = '') {
    threadListEl.innerHTML = '';

    const filtered = conversations.filter(c => (c.title || '').toLowerCase().includes(filterText));

    if (filtered.length === 0) {
      threadListEl.innerHTML = `<div class="sidebar-label" style="text-align:center; margin-top:1rem;">No chats found</div>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    filtered.forEach(c => {
      let cleanTitle = (c.title || 'New Chat').replace(/^[ "']+|[ "']+$|^"|"$/g, '').trim();
      if (!cleanTitle) cleanTitle = 'New Chat';

      const item = document.createElement('div');
      item.className = `thread-item ${c._id === activeConversationId ? 'active' : ''}`;
      item.innerHTML = `
        <div class="thread-item-content">
          <svg class="thread-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span class="thread-title">${escapeHtml(cleanTitle)}</span>
        </div>
        <button class="thread-delete-icon" type="button" title="Delete thread" data-id="${c._id}">
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

      fragment.appendChild(item);
    });

    threadListEl.appendChild(fragment);
  }

  // Create New Conversation Thread
  async function createNewConversation() {
    // Instantly reset UI to clean starter screen
    currentMessages = [];
    activeConversationId = null;
    currentChatTitle.textContent = 'New Chat';
    if (emptyStateTemplate) {
      chatLog.innerHTML = '';
      chatLog.appendChild(emptyStateTemplate.cloneNode(true));
      attachStarterCardListeners(chatLog);
    }

    try {
      const currentPersona = personaSelect ? personaSelect.value : 'general';
      const res = await fetchWithAuth('/conversations', {
        method: 'POST',
        body: JSON.stringify({ title: 'New Chat', persona: currentPersona })
      });
      const data = await res.json();
      if (data.success && data.conversation) {
        const existingIdx = conversations.findIndex(c => c._id === data.conversation._id);
        if (existingIdx >= 0) {
          conversations[existingIdx] = data.conversation;
        } else {
          conversations.unshift(data.conversation);
        }
        activeConversationId = data.conversation._id;
        renderThreadList();
        sidebar?.classList.remove('open');
        sidebarOverlay?.classList.remove('active');
        showToast('Started new chat');
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
        currentMessages = data.messages || [];
      } else {
        currentMessages = [];
      }
    } catch (e) {
      console.error('Error loading thread messages:', e);
      currentMessages = [];
    }
    renderMessageLog();
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

    if (!currentMessages || currentMessages.length === 0) {
      if (emptyStateTemplate) {
        const emptyNode = emptyStateTemplate.cloneNode(true);
        chatLog.appendChild(emptyNode);
        attachStarterCardListeners(emptyNode);
      }
      return;
    }

    currentMessages.forEach(msg => {
      appendMessageBubble(msg.role, msg.content, msg.createdAt, false);
    });

    scrollToBottom();
  }

  function attachStarterCardListeners(container) {
    container.querySelectorAll('.starter-card').forEach(card => {
      card.addEventListener('click', () => {
        const prompt = card.getAttribute('data-prompt');
        if (prompt) {
          userInput.value = prompt;
          chatForm.dispatchEvent(new Event('submit'));
        }
      });
    });
  }

  // Append Single Message Bubble
  function appendMessageBubble(role, content, timestamp = new Date(), isLiveStream = false) {
    const existingEmpty = chatLog.querySelector('.empty-state');
    if (existingEmpty) existingEmpty.remove();

    const isUser = role === 'user';
    const row = document.createElement('div');
    row.className = `message-row ${isUser ? 'user-row' : 'assistant-row'}`;

    const avatarHtml = isUser
      ? `<div class="bubble-avatar user-avatar-bubble">${(getStoredUser()?.name || 'U').charAt(0).toUpperCase()}</div>`
      : `<div class="bubble-avatar assistant-avatar" style="font-family:var(--font-heading); font-weight:800; font-size:0.75rem; color:#6366f1;">CN</div>`;

    const formattedTime = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    row.innerHTML = `
      ${avatarHtml}
      <div class="message-content-wrapper">
        <div class="message-bubble ${isUser ? 'user-bubble' : 'assistant-bubble'} ${isLiveStream ? 'streaming-cursor' : ''}">
          ${isUser ? renderUserBubbleContent(content) : (content ? parseMarkdown(content) : '<div class="streaming-dots-loader"><span class="dot dot-1"></span><span class="dot dot-2"></span><span class="dot dot-3"></span></div>')}
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

  let activeAbortController = null;

  function stopStreaming() {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    isStreaming = false;
    typingIndicator.classList.add('hidden');
    showToast('Generation stopped');
    setSendBtnState(false);
  }

  function setSendBtnState(streaming) {
    if (!sendBtn) return;
    if (streaming) {
      sendBtn.classList.add('stop-state');
      sendBtn.title = 'Stop generating';
      sendBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`;
      sendBtn.disabled = false;
    } else {
      sendBtn.classList.remove('stop-state');
      sendBtn.title = 'Send Message';
      sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
      sendBtn.disabled = !userInput.value.trim() && !currentAttachment;
    }
  }

  // Send Message with SSE Stream Reader
  async function sendMessage(text) {
    if (!activeConversationId) return;

    if (isStreaming) {
      stopStreaming();
      return;
    }

    isStreaming = true;
    activeAbortController = new AbortController();
    setSendBtnState(true);

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

    let aiRow = null;
    let bubbleEl = null;

    // 3. Initiate SSE Streaming Request with Abort Signal
    try {
      const response = await fetch(`/api/chat/${activeConversationId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        signal: activeAbortController.signal,
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
        return;
      }

      // Create live AI message row
      let accumulatedText = '';
      aiRow = appendMessageBubble('assistant', '', new Date(), true);
      bubbleEl = aiRow.querySelector('.assistant-bubble');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let renderScheduled = false;

      const scheduleRender = () => {
        if (renderScheduled) return;
        renderScheduled = true;
        requestAnimationFrame(() => {
          if (bubbleEl) bubbleEl.innerHTML = parseMarkdown(accumulatedText);
          scrollToBottom();
          renderScheduled = false;
        });
      };

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
              currentChatTitle.textContent = parsed.meta.title;
              const targetConv = conversations.find(c => c._id === parsed.meta.conversationId);
              if (targetConv) targetConv.title = parsed.meta.title;
              renderThreadList();
            }
            if (parsed.token !== undefined) {
              accumulatedText += parsed.token;
              scheduleRender();
            }
          } catch (e) {
            // Ignore partial SSE JSON frames
          }
        }
      }

      // Final render & cleanup
      if (bubbleEl) {
        bubbleEl.innerHTML = parseMarkdown(accumulatedText);
        bubbleEl.classList.remove('streaming-cursor');
        attachCodeCopyListeners(aiRow);
      }

      if (window.hljs && aiRow) {
        aiRow.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
      }
      if (window.renderMathInElement && aiRow) {
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

      if (accumulatedText) {
        currentMessages.push({ role: 'assistant', content: accumulatedText, createdAt: new Date() });
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('[Stream Aborted by User]');
      } else {
        console.error('Streaming request error:', error);
        showToast('Network error during streaming', 'danger');
      }
    } finally {
      isStreaming = false;
      activeAbortController = null;
      setSendBtnState(false);
      typingIndicator.classList.add('hidden');
      if (bubbleEl) bubbleEl.classList.remove('streaming-cursor');
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

  // -------------------------------------------------------------------------
  // Gemini-Style Settings & Personal Intelligence Modal Logic
  // -------------------------------------------------------------------------
  function setupSettingsModal() {
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const backdrop = settingsModal?.querySelector('.settings-backdrop');
    const navItems = settingsModal?.querySelectorAll('.settings-nav-item');
    const tabPanels = settingsModal?.querySelectorAll('.settings-tab-panel');
    const settingsTabTitle = document.getElementById('settingsTabTitle');

    const clearMemoriesBtn = document.getElementById('clearMemoriesBtn');
    const addMemoryBtn = document.getElementById('addMemoryBtn');
    const manualMemoryInput = document.getElementById('manualMemoryInput');
    const tempSlider = document.getElementById('tempSlider');
    const tempValue = document.getElementById('tempValue');
    const saveLocationBtn = document.getElementById('saveLocationBtn');
    const userLocationInput = document.getElementById('userLocationInput');
    const settingsFooterLocation = document.getElementById('settingsFooterLocation');

    // Tab Navigation
    const tabTitles = {
      intelligence: 'Personal Intelligence',
      provider: 'AI Model & Provider',
      spark: 'Gemini Spark Settings',
      theme: 'Theme & Appearance',
      location: 'Location Context',
      stats: 'Usage & Limits'
    };

    navItems?.forEach(item => {
      item.addEventListener('click', () => {
        const tab = item.getAttribute('data-tab');
        navItems.forEach(n => n.classList.remove('active'));
        tabPanels?.forEach(p => {
          p.classList.add('hidden');
          p.classList.remove('active');
        });

        item.classList.add('active');
        const targetPanel = document.getElementById(`tab-${tab}`);
        if (targetPanel) {
          targetPanel.classList.remove('hidden');
          targetPanel.classList.add('active');
        }
        if (settingsTabTitle) settingsTabTitle.textContent = tabTitles[tab] || 'Settings';
      });
    });

    // Close Modal Event Listeners
    closeSettingsBtn?.addEventListener('click', () => closeSettingsModal());
    backdrop?.addEventListener('click', () => closeSettingsModal());

    // Settings Persona Select Handler
    const settingsPersona = document.getElementById('settingsPersona');
    settingsPersona?.addEventListener('change', async (e) => {
      const newPersona = e.target.value;
      if (personaSelect) personaSelect.value = newPersona;
      activePersonaBadge.textContent = getPersonaLabel(newPersona);
      showToast(`AI Persona updated to: ${getPersonaLabel(newPersona)}`);
      if (activeConversationId) {
        await fetchWithAuth(`/conversations/${activeConversationId}`, {
          method: 'PATCH',
          body: JSON.stringify({ persona: newPersona })
        });
      }
    });

    // Temperature Slider
    tempSlider?.addEventListener('input', (e) => {
      if (tempValue) tempValue.textContent = e.target.value;
    });

    // Clear All Memories
    clearMemoriesBtn?.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to clear all stored memories?')) return;
      try {
        const res = await fetchWithAuth('/auth/memories', { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          showToast('All stored memories cleared');
          loadUserMemories();
        }
      } catch (e) {
        showToast('Failed to clear memories', 'danger');
      }
    });

    // Add Memory Manually
    addMemoryBtn?.addEventListener('click', async () => {
      const text = manualMemoryInput?.value.trim();
      if (!text) return;
      try {
        // Send a memory extract prompt to backend
        await fetchWithAuth('/chat/' + (activeConversationId || 'dummy'), {
          method: 'POST',
          body: JSON.stringify({ message: `remember this fact: ${text}` })
        });
        manualMemoryInput.value = '';
        showToast(`Saved memory: "${text.slice(0, 30)}..."`);
        setTimeout(loadUserMemories, 500);
      } catch (e) {
        showToast('Could not save memory', 'danger');
      }
    });

    // Save Location
    saveLocationBtn?.addEventListener('click', () => {
      const loc = userLocationInput?.value.trim();
      if (loc) {
        if (settingsFooterLocation) settingsFooterLocation.textContent = loc;
        localStorage.setItem('chatnest_location', loc);
        showToast(`Location context set to: ${loc}`);
      }
    });

    // Accent Color Swatches
    const colorSwatches = document.querySelectorAll('.color-swatch-btn');
    colorSwatches.forEach(swatch => {
      swatch.addEventListener('click', () => {
        colorSwatches.forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        const accent = swatch.getAttribute('data-accent');
        showToast(`Accent theme updated: ${accent}`);
      });
    });

    // Theme Mode Toggle Buttons inside Settings Drawer
    const themeOptionBtns = document.querySelectorAll('.theme-option-btn');
    themeOptionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        themeOptionBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const themeVal = btn.getAttribute('data-theme-val');
        document.documentElement.setAttribute('data-theme', themeVal);
        localStorage.setItem('theme', themeVal);
        showToast(`Theme mode set to ${themeVal === 'dark' ? 'Dark Arena' : 'Light Stone'}`);
      });
    });

    // Initialize Theme Active State from localStorage
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    themeOptionBtns.forEach(btn => {
      if (btn.getAttribute('data-theme-val') === savedTheme) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Saved Location Restore
    const savedLoc = localStorage.getItem('chatnest_location') || 'Delhi, India';
    if (userLocationInput) userLocationInput.value = savedLoc;
    if (settingsFooterLocation) settingsFooterLocation.textContent = savedLoc;
  }

  function openSettingsModal() {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
      settingsModal.classList.remove('hidden');
      const settingsPersona = document.getElementById('settingsPersona');
      if (settingsPersona && personaSelect) {
        settingsPersona.value = personaSelect.value || 'general';
      }
      loadUserMemories();
      updateSessionStats();
    }
  }

  function closeSettingsModal() {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
      settingsModal.classList.add('hidden');
    }
  }

  async function loadUserMemories() {
    const memoriesList = document.getElementById('memoriesList');
    const memoryCount = document.getElementById('memoryCount');
    if (!memoriesList) return;

    try {
      const res = await fetchWithAuth('/auth/memories');
      const data = await res.json();
      if (data.success && Array.isArray(data.memories)) {
        if (memoryCount) memoryCount.textContent = data.memories.length;

        if (data.memories.length === 0) {
          memoriesList.innerHTML = `<div class="empty-memories">No stored memories yet. Chat with ChatNest to automatically save personal context!</div>`;
          return;
        }

        let html = '';
        data.memories.forEach(m => {
          html += `
            <div class="memory-item">
              <span>${escapeHtml(m.fact)}</span>
              <small style="color:var(--text-dim);">${new Date(m.createdAt).toLocaleDateString()}</small>
            </div>
          `;
        });
        memoriesList.innerHTML = html;
      }
    } catch (e) {
      console.error('Error loading memories:', e);
    }
  }

  function updateSessionStats() {
    const statMessageCount = document.getElementById('statMessageCount');
    const statThreadCount = document.getElementById('statThreadCount');
    if (statMessageCount) statMessageCount.textContent = currentMessages.length;
    if (statThreadCount) statThreadCount.textContent = conversations.length;
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
  function scrollToBottom(force = false) {
    if (force || !isUserScrolledUp) {
      chatLog.scrollTop = chatLog.scrollHeight;
    }
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
      let docIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
      if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) docIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
      else if (['js', 'py', 'ts', 'html', 'css', 'cpp', 'c', 'java', 'sql', 'xml'].includes(ext)) docIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';

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
