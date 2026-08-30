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

  // Toggle Show / Hide Password (Eye Button)
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const passwordInput = document.getElementById('password');
  const eyeIconShow = document.getElementById('eyeIconShow');
  const eyeIconHide = document.getElementById('eyeIconHide');

  if (togglePasswordBtn && passwordInput) {
    togglePasswordBtn.addEventListener('click', () => {
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      eyeIconShow?.classList.toggle('hidden');
      eyeIconHide?.classList.toggle('hidden');
    });
  }

  // ChatGPT / Gemini Style 2-Step Single Form Auth State
  let currentAuthStep = 'email'; // 'email' | 'password'
  let emailCheckedState = { exists: false, isGoogle: false, email: '' };

  const emailGroup = document.getElementById('emailGroup');
  const passwordGroup = document.getElementById('passwordGroup');
  const enteredEmailLabel = document.getElementById('enteredEmailLabel');
  const editEmailBtn = document.getElementById('editEmailBtn');
  const submitBtnText = document.getElementById('submitBtn')?.querySelector('.btn-text');

  if (editEmailBtn) {
    editEmailBtn.addEventListener('click', () => {
      currentAuthStep = 'email';
      passwordGroup?.classList.add('hidden');
      emailGroup?.classList.remove('hidden');
      if (submitBtnText) submitBtnText.textContent = 'Continue';
      hideAlert();
    });
  }

  // Handle ChatGPT / Gemini 2-Step Form Submission
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert();

      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');
      const email = emailInput ? emailInput.value.trim() : '';

      // STEP 1: Verify & Check Email (ChatGPT style)
      if (currentAuthStep === 'email') {
        if (!email) {
          showAlert('Please enter your email address.');
          return;
        }

        setSubmitting(true);
        try {
          const res = await fetch('/api/auth/check-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });
          const data = await res.json();
          setSubmitting(false);

          if (!data.success) {
            showAlert(data.error || 'Please enter a valid email address.');
            return;
          }

          emailCheckedState = data;
          currentAuthStep = 'password';

          emailGroup?.classList.add('hidden');
          passwordGroup?.classList.remove('hidden');

          if (enteredEmailLabel) enteredEmailLabel.textContent = data.email;

          if (data.exists) {
            if (submitBtnText) submitBtnText.textContent = 'Sign In';
            passwordInput?.focus();
          } else {
            if (submitBtnText) submitBtnText.textContent = 'Create Account & Continue';
            showAlert('New to ChatNest? Create a password to set up your account.', 'info');
            passwordInput?.focus();
          }
        } catch (err) {
          console.error('Check Email Error:', err);
          showAlert('Network error checking email domain.');
          setSubmitting(false);
        }
        return;
      }

      // STEP 2: Authenticate or Register with Password
      if (currentAuthStep === 'password') {
        const password = passwordInput ? passwordInput.value : '';
        if (!password) {
          showAlert('Please enter a password.');
          return;
        }

        if (password.length < 6) {
          showAlert('Password must be at least 6 characters long.');
          return;
        }

        setSubmitting(true);

        const endpoint = emailCheckedState.exists ? '/api/auth/login' : '/api/auth/register';
        const payload = emailCheckedState.exists
          ? { email: emailCheckedState.email, password }
          : { name: emailCheckedState.email.split('@')[0], email: emailCheckedState.email, password };

        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          const data = await response.json();

          if (data.success) {
            setAuthToken(data.token);
            setStoredUser(data.user);
            showAlert('Authentication successful! Redirecting...', 'success');
            setTimeout(() => {
              window.location.href = 'chat.html';
            }, 800);
          } else {
            showAlert(data.error || 'Authentication failed. Please check your credentials.');
            setSubmitting(false);
          }
        } catch (error) {
          console.error('Auth Submit Error:', error);
          showAlert('Network error. Please make sure the server is running.');
          setSubmitting(false);
        }
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
