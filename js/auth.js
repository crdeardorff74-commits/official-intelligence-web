/**
 * Official Intelligence - Auth Module
 * Shared authentication functions for all pages
 */

const API_URL = 'https://official-intelligence-api.onrender.com';
let currentUser = null;
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
        const res = await fetch(`${API_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.ok) {
            const data = await res.json();
            currentUser = data.user;
            updateUserMenu();
        } else {
            localStorage.removeItem('oi_token');
        }
    } catch (err) {
        console.error('Auth check failed:', err);
    }
}

function updateUserMenu() {
    const menu = document.getElementById('userMenu');
    if (menu && currentUser) {
        menu.innerHTML = `
            <div class="user-info">
                ${currentUser.avatar_url ? `<img src="${currentUser.avatar_url}" alt="">` : ''}
                <span>${currentUser.display_name || currentUser.username}</span>
                <button onclick="logout()" style="margin-left: 10px;">LOGOUT</button>
            </div>
        `;
    }
}

function logout() {
    localStorage.removeItem('oi_token');
    currentUser = null;
    const menu = document.getElementById('userMenu');
    if (menu) {
        menu.innerHTML = '<button onclick="showLoginModal()">LOGIN</button>';
    }
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
        const res = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        const data = await res.json();
        
        if (res.ok && data.token) {
            localStorage.setItem('oi_token', data.token);
            currentUser = data.user;
            hideLoginModal();
            updateUserMenu();
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
    
    // Update game links with auth token (all game subdomains)
    const token = localStorage.getItem('oi_token');
    if (token) {
        const gameSubdomains = ['blockchainstorm', 'tantris'];
        const selector = gameSubdomains.map(s => `a[href*="${s}"]`).join(', ');
        document.querySelectorAll(selector).forEach(link => {
            const url = new URL(link.href);
            url.searchParams.set('token', token);
            link.href = url.toString();
        });
    }
});
