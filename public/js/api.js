/**
 * ChatNest API & Auth Storage Helper
 */

const API_BASE = '/api';

// Token Storage Helpers
const getAuthToken = () => localStorage.getItem('chatnest_token');
const setAuthToken = (token) => localStorage.setItem('chatnest_token', token);
const clearAuthToken = () => {
  localStorage.removeItem('chatnest_token');
  localStorage.removeItem('chatnest_user');
};

const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('chatnest_user'));
  } catch (e) {
    return null;
  }
};
const setStoredUser = (user) => localStorage.setItem('chatnest_user', JSON.stringify(user));

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
function showToast(message, type = 'info') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
