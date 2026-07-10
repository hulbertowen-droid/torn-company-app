// shared.js - Core functionality for all pages

document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('.sidebar')) {
        document.body.insertAdjacentHTML('afterbegin', getSidebarHTML(window.location.pathname === '/' ? '/index.html' : window.location.pathname));
    }
    initSidebar();
    initToastContainer();
    initSocketIO();
    initPWA();
});

function initPWA() {
    // Add manifest link dynamically
    if (!document.querySelector('link[rel="manifest"]')) {
        let manifest = document.createElement('link');
        manifest.rel = 'manifest';
        manifest.href = '/manifest.json';
        document.head.appendChild(manifest);
    }
    
    // Register service worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(registration => console.log('SW registered:', registration.scope))
                .catch(err => console.log('SW registration failed:', err));
        });
    }
}

function initSocketIO() {
    const socketScript = document.createElement('script');
    socketScript.src = '/socket.io/socket.io.js';
    socketScript.onload = () => {
        const socket = io();
        socket.on('refreshData', () => {
            if (typeof fetchWarboardData === 'function') fetchWarboardData();
            if (typeof fetchDashboardData === 'function') fetchDashboardData();
        });
    };
    document.head.appendChild(socketScript);
}

// --- SIDEBAR LOGIC ---
function initSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    // Load saved state
    if (localStorage.getItem('sidebar_collapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }

    // Add mobile toggle if on small screen
    if (window.innerWidth <= 768) {
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'mobile-menu-btn';
        toggleBtn.innerHTML = '☰';
        toggleBtn.style.cssText = 'position:fixed; top:15px; left:15px; z-index:101; background:var(--card-solid); border:1px solid var(--card-border); color:white; border-radius:8px; padding:8px 12px; cursor:pointer;';
        toggleBtn.onclick = () => {
            sidebar.classList.toggle('open');
        };
        document.body.appendChild(toggleBtn);
        
        // Close sidebar when clicking outside on mobile
        document.querySelector('.main-content').addEventListener('click', () => {
            if (sidebar.classList.contains('open')) sidebar.classList.remove('open');
        });
    }
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebar_collapsed', sidebar.classList.contains('collapsed'));
}

// --- NAVIGATION & SETTINGS ---
function openSettings() {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
        settingsModal.style.display = 'flex';
    } else {
        // If not on index.html where modal lives, redirect with a hash flag
        window.location.href = '/index.html#settings';
    }
}

function closeSettings() {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) settingsModal.style.display = 'none';
}

// --- NOTIFICATION SYSTEM (TOASTS) ---
function initToastContainer() {
    if (!document.getElementById('toast-container')) {
        const container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
}

function showToast(message, type = 'success', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// --- UTILITIES ---

// Fetch wrapper with standard error handling
async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch(endpoint, options);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || `HTTP error ${response.status}`);
        }
        return data;
    } catch (error) {
        console.error(`API Error (${endpoint}):`, error);
        throw error;
    }
}

// Format numbers (e.g., 1.2M, 450K)
function formatStat(num) {
    if (!num || isNaN(num)) return "0";
    num = Number(num);
    if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
    if (num >= 1e6) return (num / 1e6).toFixed(1) + "M";
    if (num >= 1e3) return (num / 1e3).toFixed(1) + "K";
    return num.toLocaleString();
}

// Get standard sidebar HTML to inject dynamically or copy-paste
function getSidebarHTML(activePage) {
    const navItems = [
        { path: '/', icon: '⚔️', label: 'Warboard' },
        { path: '/dashboard.html', icon: '📊', label: 'Dashboard' },
        { path: '/chain.html', icon: '🔗', label: 'Chain Tracker' },
        { path: '/bazaar.html', icon: '🛒', label: 'Bazaar' },
        { path: '/discord.html', icon: '💬', label: 'Discord Alerts' },
        { path: '/oc-planner.html', icon: '🕵️', label: 'OC Planner' },
        { path: '/payout.html', icon: '💰', label: 'War Payouts' },
        { path: '/recruitment.html', icon: '🎯', label: 'Recruitment' }
    ];

    let navHtml = navItems.map(item => `
        <a href="${item.path}" class="nav-link ${(activePage === item.path || (activePage === '/index.html' && item.path === '/')) ? 'active' : ''}">
            <span class="nav-icon">${item.icon}</span>
            <span class="nav-text">${item.label}</span>
        </a>
    `).join('');

    return `
        <div class="sidebar">
            <div class="sidebar-header">
                <span class="sidebar-logo">TORN TOOLS</span>
                <button class="toggle-btn" onclick="toggleSidebar()">⇄</button>
            </div>
            <div class="nav-items">
                ${navHtml}
            </div>
            <div class="nav-bottom">
                <a href="/admin.html" class="nav-link ${activePage === '/admin.html' ? 'active' : ''}">
                    <span class="nav-icon">👑</span>
                    <span class="nav-text">Admin</span>
                </a>
                <a href="javascript:void(0)" onclick="openSettings()" class="nav-link">
                    <span class="nav-icon">⚙️</span>
                    <span class="nav-text">Settings</span>
                </a>
            </div>
        </div>
    `;
}
