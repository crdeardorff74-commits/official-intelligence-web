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
        const adminLinks = authCurrentUser.is_admin ? `
            <a href="/admin/blog" style="margin-right: 10px; color: var(--primary);">BLOG</a>
            <a href="/admin/tantro" style="margin-right: 10px; color: var(--primary);">GAME</a>
        ` : '';
        
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

function showLoginModal() {
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
