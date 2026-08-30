/**
 * ChatNest API & Auth Storage Helper
 */

const API_BASE = '/api';

// Memory Caches for localStorage reads
let _cachedToken = null;
let _cachedUser = null;

// Token Storage Helpers
const getAuthToken = () => {
  if (_cachedToken === null) {
    _cachedToken = localStorage.getItem('chatnest_token');
  }
  return _cachedToken;
};

const setAuthToken = (token) => {
  _cachedToken = token;
  localStorage.setItem('chatnest_token', token);
};

const clearAuthToken = () => {
  _cachedToken = '';
  _cachedUser = null;
  localStorage.removeItem('chatnest_token');
  localStorage.removeItem('chatnest_user');
};

const getStoredUser = () => {
  if (_cachedUser !== null) return _cachedUser;
  try {
    _cachedUser = JSON.parse(localStorage.getItem('chatnest_user'));
    return _cachedUser;
  } catch (e) {
    return null;
  }
};

const setStoredUser = (user) => {
  _cachedUser = user;
  localStorage.setItem('chatnest_user', JSON.stringify(user));
};

/**
 * Fetch wrapper automatically injecting Bearer JWT token
 */
async function fetchWithAuth(endpoint, options = {}) {
  const token = getAuthToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  // Handle unauthorized/expired token
  if (response.status === 401) {
    clearAuthToken();
    if (!window.location.pathname.endsWith('index.html') && !window.location.pathname.endsWith('register.html') && window.location.pathname !== '/') {
      window.location.href = 'index.html';
    }
  }

  return response;
}

/**
 * Toast Notification Utility
 */
let _toastContainerRef = null;
function showToast(message, type = 'info') {
  if (!_toastContainerRef || !_toastContainerRef.isConnected) {
    _toastContainerRef = document.getElementById('toastContainer');
    if (!_toastContainerRef) {
      _toastContainerRef = document.createElement('div');
      _toastContainerRef.id = 'toastContainer';
      _toastContainerRef.className = 'toast-container';
      document.body.appendChild(_toastContainerRef);
    }
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span>`;

  _toastContainerRef.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
