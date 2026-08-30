/**
 * ChatNest Auth Pages Handler (Login & Register)
 */

document.addEventListener('DOMContentLoaded', () => {
  // If user is already logged in, redirect to chat.html
  const token = getAuthToken();
  if (token && (window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('register.html') || window.location.pathname === '/')) {
    window.location.href = 'chat.html';
    return;
  }

  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const alertBox = document.getElementById('authAlert');

  const showAlert = (message, type = 'danger') => {
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.className = `auth-alert alert-${type}`;
    alertBox.classList.remove('hidden');
  };

  const hideAlert = () => {
    if (!alertBox) return;
    alertBox.classList.add('hidden');
  };

  const setSubmitting = (isSubmitting) => {
    const submitBtn = document.getElementById('submitBtn');
    if (!submitBtn) return;
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoader = submitBtn.querySelector('.btn-loader');

    submitBtn.disabled = isSubmitting;
    if (isSubmitting) {
      btnText?.classList.add('hidden');
      btnLoader?.classList.remove('hidden');
    } else {
      btnText?.classList.remove('hidden');
      btnLoader?.classList.add('hidden');
    }
  };

  // Handle Login Submission
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert();

      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;

      if (!email || !password) {
        showAlert('Please fill in all fields.');
        return;
      }

      setSubmitting(true);

      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (data.success) {
          setAuthToken(data.token);
          setStoredUser(data.user);
          showAlert('Login successful! Redirecting...', 'success');
          setTimeout(() => {
            window.location.href = 'chat.html';
          }, 800);
        } else {
          showAlert(data.error || 'Login failed. Please check your credentials.');
          setSubmitting(false);
        }
      } catch (error) {
        console.error('Login Error:', error);
        showAlert('Network error. Please make sure the server is running.');
        setSubmitting(false);
      }
    });
  }

  // Handle Registration Submission
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert();

      const name = document.getElementById('name').value.trim();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;

      if (!name || !email || !password) {
        showAlert('Please fill in all required fields.');
        return;
      }

      if (password.length < 6) {
        showAlert('Password must be at least 6 characters long.');
        return;
      }

      setSubmitting(true);

      try {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password })
        });

        const data = await response.json();

        if (data.success) {
          setAuthToken(data.token);
          setStoredUser(data.user);
          showAlert('Account created! Redirecting to chat...', 'success');
          setTimeout(() => {
            window.location.href = 'chat.html';
          }, 800);
        } else {
          showAlert(data.error || 'Registration failed. Please try again.');
          setSubmitting(false);
        }
      } catch (error) {
        console.error('Registration Error:', error);
        showAlert('Network error. Please make sure the server is running.');
        setSubmitting(false);
      }
    });
  }

  // Handle Google Auth Click
  // Google Account Chooser Modal Setup
  const googleAuthBtn = document.getElementById('googleAuthBtn');
  const googleAccountModal = document.getElementById('googleAccountModal');
  const closeGoogleModalBtn = document.getElementById('closeGoogleModalBtn');
  const useAnotherGoogleBtn = document.getElementById('useAnotherGoogleBtn');

  if (googleAuthBtn && googleAccountModal) {
    googleAuthBtn.addEventListener('click', () => {
      googleAccountModal.classList.remove('hidden');
    });

    closeGoogleModalBtn?.addEventListener('click', () => {
      googleAccountModal.classList.add('hidden');
    });

    googleAccountModal.addEventListener('click', (e) => {
      if (e.target === googleAccountModal) {
        googleAccountModal.classList.add('hidden');
      }
    });

    // Account items click handler
    document.querySelectorAll('.google-account-item').forEach(item => {
      item.addEventListener('click', () => {
        const email = item.getAttribute('data-email');
        const name = item.getAttribute('data-name');
        googleAccountModal.classList.add('hidden');
        if (email) performEmailGoogleLogin(email, name);
      });
    });

    // Use another account click
    useAnotherGoogleBtn?.addEventListener('click', () => {
      googleAccountModal.classList.add('hidden');
      const emailPrompt = prompt('Enter your Gmail address to sign in:');
      if (emailPrompt && emailPrompt.trim()) {
        performEmailGoogleLogin(emailPrompt.trim());
      }
    });
  }

  const GMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@(gmail|googlemail)\.com$/i;

  async function performEmailGoogleLogin(emailStr, customName = null) {
    const cleanEmail = (emailStr || '').toLowerCase().trim();
    if (!GMAIL_REGEX.test(cleanEmail)) {
      showAlert('Invalid Gmail address! Please enter a valid @gmail.com account (e.g. name@gmail.com).', 'danger');
      return;
    }

    const userName = customName || cleanEmail.split('@')[0].replace(/[^a-zA-Z]/g, ' ').trim() || 'Google User';
    hideAlert();
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, name: userName })
      });
      const data = await response.json();
      if (data.success) {
        setAuthToken(data.token);
        setStoredUser(data.user);
        showAlert(`Signed in as ${data.user.email}! Redirecting...`, 'success');
        setTimeout(() => { window.location.href = 'chat.html'; }, 800);
      } else {
        showAlert(data.error || 'Google authentication failed.', 'danger');
        setSubmitting(false);
      }
    } catch (e) {
      console.error('Google Auth Error:', e);
      showAlert('Network error during Google authentication.', 'danger');
      setSubmitting(false);
    }
  }
});
