/**
 * Official Intelligence - Auth Module
 * Shared authentication functions for all pages
 * Modified for BLOCKCHaiNSTORM game integration
 */

const AUTH_API_URL = 'https://official-intelligence-api.onrender.com';
const API_URL = AUTH_API_URL; // Alias for compatibility
let authCurrentUser = null;
let isRegisterMode = false;

// Check for OAuth callback token
function handleOAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    
    if (token) {
        localStorage.setItem('oi_token', token);
        window.history.replaceState({}, document.title, window.location.pathname);
        checkAuth();
    }
}

// Check auth status
async function checkAuth() {
    const token = localStorage.getItem('oi_token');
    if (!token) return;
    
    try {
        const res = await fetch(`${AUTH_API_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.ok) {
            const data = await res.json();
            authCurrentUser = data.user;
            updateUserMenu();
            updateIntroLoginButton();
        } else {
            localStorage.removeItem('oi_token');
        }
    } catch (err) {
        console.error('Auth check failed:', err);
    }
}

function updateUserMenu() {
    const menu = document.getElementById('userMenu');
    if (menu && authCurrentUser) {
        // Single ADMIN link to the hub at /admin/ (the hub itself has the
        // sub-pages: Blog, Songs, TANTЯO stats, Circuitousness stats).
        // Was three separate links (BLOG / GAME / SONGS); collapsed to one
        // so the nav stays clean as more per-game admin pages get added.
        const adminLinks = authCurrentUser.is_admin
            ? '<a href="/admin/" style="margin-right: 10px; color: var(--primary);">ADMIN</a>'
            : '';
        
        menu.innerHTML = `
            <div class="user-info">
                ${adminLinks}
                ${authCurrentUser.avatar_url ? `<img src="${authCurrentUser.avatar_url}" alt="">` : ''}
                <span>${authCurrentUser.display_name || authCurrentUser.username}</span>
                <button onclick="logout()" style="margin-left: 10px;">LOGOUT</button>
            </div>
        `;
    }
}

// Update intro screen login button visibility
function updateIntroLoginButton() {
    const introLoginBtn = document.getElementById('introLoginBtn');
    if (introLoginBtn) {
        const isLoggedIn = !!localStorage.getItem('oi_token');
        introLoginBtn.classList.toggle('hidden', isLoggedIn);
    }
}

function logout() {
    localStorage.removeItem('oi_token');
    authCurrentUser = null;
    const menu = document.getElementById('userMenu');
    if (menu) {
        menu.innerHTML = '<button onclick="showLoginModal()">LOGIN</button>';
    }
    updateIntroLoginButton();
}

// The login/register modal markup originally lived only on the home
// page, so the LOGIN button on other pages (e.g. /blog) silently did
// nothing. Inject an identical modal on demand so the button works on
// every page that loads auth.js. No-op on pages that already have one.
function ensureLoginModal() {
    if (document.getElementById('loginModal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <div class="modal-overlay" id="loginModal">
        <div class="modal" style="position: relative;">
            <button class="modal-close" onclick="hideLoginModal()">&times;</button>

            <h2 id="modalTitle">LOGIN</h2>

            <div class="error-message" id="loginError"></div>

            <form id="loginForm" onsubmit="handleLogin(event)">
                <div class="form-group" id="usernameGroup" style="display: none;">
                    <label>USERNAME</label>
                    <input type="text" id="username" name="username" autocomplete="username">
                </div>

                <div class="form-group">
                    <label>EMAIL</label>
                    <input type="email" id="email" name="email" required autocomplete="email">
                </div>

                <div class="form-group">
                    <label>PASSWORD</label>
                    <input type="password" id="password" name="password" required autocomplete="current-password">
                </div>

                <div style="text-align: right; margin-bottom: 15px;">
                    <a href="/reset-password" style="font-size: 12px; color: var(--text-dim);">Forgot password?</a>
                </div>

                <button type="submit" class="btn btn-primary" id="submitBtn" style="width: 100%;">ENTER</button>
            </form>

            <div class="divider">OR</div>

            <div class="oauth-buttons">
                <a href="https://official-intelligence-api.onrender.com/auth/google/login" class="btn btn-oauth">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                    Continue with Google
                </a>
            </div>

            <div class="modal-footer">
                <span id="authToggleText">No account?</span>
                <a href="#" id="authToggle" onclick="toggleAuthMode(event)">Sign up</a>
            </div>
        </div>
    </div>`;
    document.body.appendChild(wrap.firstElementChild);
    // The DOMContentLoaded wiring below already ran without a modal on
    // this page, so attach the outside-click-to-close handler here.
    document.getElementById('loginModal').addEventListener('click', (e) => {
        if (e.target.id === 'loginModal') hideLoginModal();
    });
}

function showLoginModal() {
    ensureLoginModal();
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.classList.add('active');
    }
}

function hideLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.classList.remove('active');
    }
    const errorDiv = document.getElementById('loginError');
    if (errorDiv) {
        errorDiv.style.display = 'none';
    }
    const form = document.getElementById('loginForm');
    if (form) {
        form.reset();
    }
    // Update intro login button after modal closes
    updateIntroLoginButton();
}

function toggleAuthMode(e) {
    e.preventDefault();
    isRegisterMode = !isRegisterMode;
    
    const title = document.getElementById('modalTitle');
    const usernameGroup = document.getElementById('usernameGroup');
    const submitBtn = document.getElementById('submitBtn');
    const toggleText = document.getElementById('authToggleText');
    const toggleLink = document.getElementById('authToggle');
    
    if (isRegisterMode) {
        if (title) title.textContent = 'REGISTER';
        if (usernameGroup) usernameGroup.style.display = 'block';
        if (submitBtn) submitBtn.textContent = 'CREATE ACCOUNT';
        if (toggleText) toggleText.textContent = 'Already have an account?';
        if (toggleLink) toggleLink.textContent = 'Login';
    } else {
        if (title) title.textContent = 'LOGIN';
        if (usernameGroup) usernameGroup.style.display = 'none';
        if (submitBtn) submitBtn.textContent = 'ENTER';
        if (toggleText) toggleText.textContent = 'No account?';
        if (toggleLink) toggleLink.textContent = 'Sign up';
    }
}

function showError(message) {
    const errorDiv = document.getElementById('loginError');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
}

async function handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const username = document.getElementById('username').value;
    
    const endpoint = isRegisterMode ? '/auth/register' : '/auth/login';
    const body = isRegisterMode 
        ? { email, password, username }
        : { email, password };
    
    try {
        const res = await fetch(`${AUTH_API_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        const data = await res.json();
        
        if (res.ok && data.token) {
            localStorage.setItem('oi_token', data.token);
            authCurrentUser = data.user;
            hideLoginModal();
            updateUserMenu();
            updateIntroLoginButton();
        } else {
            showError(data.error || 'Authentication failed');
        }
    } catch (err) {
        showError('Connection failed. Try again.');
    }
}

// Utility functions
function formatDate(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize auth on page load
document.addEventListener('DOMContentLoaded', () => {
    handleOAuthCallback();
    checkAuth();
    
    // Close modal on outside click
    const loginModal = document.getElementById('loginModal');
    if (loginModal) {
        loginModal.addEventListener('click', (e) => {
            if (e.target.id === 'loginModal') hideLoginModal();
        });
    }
    
    // Close modal on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideLoginModal();
    });
});
