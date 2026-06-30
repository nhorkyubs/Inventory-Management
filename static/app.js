// PWA Setup
const APP_NAME = 'IT Equipment Inventory';
const DB_NAME = 'InventoryDB';
const STORE_NAME = 'items';
let currentEditId = null;
let deferredPrompt = null;
let isOnline = navigator.onLine;
let currentUser = null;
let isViewer = false;
let isAdmin = false;
let isSuperAdmin = false;

function isOperator() {
    return isAdmin || isSuperAdmin;
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const authenticated = await checkAuth();
    if (!authenticated) return;

    applyRoleUI();
    registerServiceWorker();
    setupEventListeners();
    loadInventory();
    loadStats();
    setupInstallPrompt();
    checkOnlineStatus();
    initIndexedDB();
});

async function checkAuth() {
    try {
        const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
        if (!response.ok) {
            window.location.href = '/login';
            return false;
        }
        const data = await response.json();
        currentUser = data.user;
        isViewer = currentUser.role === 'viewer';
        isAdmin = currentUser.role === 'admin';
        isSuperAdmin = currentUser.role === 'super_admin';
        displayUserInfo();
        return true;
    } catch (error) {
        window.location.href = '/login';
        return false;
    }
}

function applyRoleUI() {
    const adminOnlyTabs = document.querySelectorAll('.admin-only-tab');
    const adminOnlyBtns = document.querySelectorAll('.admin-only-btn');
    const addItemBtn = document.getElementById('addItemBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const backBtn = document.getElementById('backBtn');
    const userInfo = document.getElementById('userInfo');
    const lastCol = document.getElementById('inventoryLastCol');
    const createAdminSection = document.getElementById('createAdminSection');

    if (isViewer) {
        adminOnlyTabs.forEach(el => el.style.display = 'none');
        adminOnlyBtns.forEach(el => el.style.display = 'none');
        if (addItemBtn) addItemBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (backBtn) backBtn.style.display = 'inline-block';
        if (userInfo) userInfo.style.display = 'none';
        if (lastCol) lastCol.textContent = 'Entry By';
    } else {
        adminOnlyTabs.forEach(el => el.style.display = '');
        adminOnlyBtns.forEach(el => el.style.display = '');
        if (addItemBtn) addItemBtn.style.display = 'inline-block';
        if (logoutBtn) logoutBtn.style.display = 'inline-block';
        if (backBtn) backBtn.style.display = 'none';
        if (userInfo) userInfo.style.display = '';
        if (lastCol) lastCol.textContent = 'Actions';
        if (createAdminSection) {
            createAdminSection.style.display = isSuperAdmin ? 'block' : 'none';
        }
    }
}

function goToLanding() {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
        .finally(() => { window.location.href = '/login'; });
}

function displayUserInfo() {
    if (isViewer) return;
    const userInfo = document.getElementById('userInfo');
    const initial = currentUser.full_name ? currentUser.full_name.charAt(0).toUpperCase() : '?';
    const avatarHtml = currentUser.profile_pic
        ? `<img src="${escapeHtml(currentUser.profile_pic)}" alt="" class="user-avatar">`
        : `<span class="user-avatar-placeholder">${escapeHtml(initial)}</span>`;

    userInfo.innerHTML = `
        <span class="user-badge" onclick="openProfileModal()" title="Edit profile">
            ${avatarHtml}
            ${escapeHtml(currentUser.full_name)}
        </span>
    `;
}

async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (error) {
        console.error('Logout error:', error);
    }
    window.location.href = '/login';
}

async function apiFetch(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    });

    if (response.status === 401) {
        window.location.href = '/login';
        throw new Error('Session expired');
    }

    return response;
}

// Service Worker Registration
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.register('/static/sw.js');
            console.log('Service Worker registered:', reg);
        } catch (error) {
            console.log('SW registration failed:', error);
        }
    }
}

// IndexedDB Setup
let db;

function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('date_entry', 'date_entry', { unique: false });
            }
        };
    });
}

async function saveToIndexedDB(items) {
    if (!db) return;

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);

        items.forEach(item => {
            store.put(item);
        });

        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => resolve();
    });
}

async function getFromIndexedDB() {
    if (!db) return [];

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

async function deleteFromIndexedDB(itemId) {
    if (!db) return;

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(itemId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}

function setupEventListeners() {
    window.addEventListener('online', () => {
        isOnline = true;
        updateStatusBadge();
        showAlert('Back online!', 'success');
    });

    window.addEventListener('offline', () => {
        isOnline = false;
        updateStatusBadge();
        showAlert('You are offline - changes will sync when online', 'warning');
    });

    const avatarInput = document.getElementById('avatarInput');
    if (avatarInput) {
        avatarInput.addEventListener('change', handleAvatarUpload);
    }
}

function checkOnlineStatus() {
    updateStatusBadge();
}

function updateStatusBadge() {
    const badge = document.getElementById('statusBadge');
    if (!badge) return;
    if (isOnline) {
        badge.textContent = 'Online';
        badge.classList.remove('offline');
    } else {
        badge.textContent = 'Offline';
        badge.classList.add('offline');
    }
}

function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        document.getElementById('installBtn').style.display = 'block';
    });

    document.getElementById('installBtn').addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response: ${outcome}`);
            deferredPrompt = null;
        }
    });
}

function switchTab(tabName) {
    if (isViewer && !['dashboard', 'inventory'].includes(tabName)) return;

    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    document.getElementById(tabName).classList.add('active');
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (tabBtn) tabBtn.classList.add('active');

    if (tabName === 'inventory') {
        loadInventory();
    } else if (tabName === 'dashboard') {
        loadStats();
    } else if (tabName === 'admin') {
        loadAdminUsers();
    } else if (tabName === 'logs') {
        loadDeletedLogs();
    }
}

async function loadInventory() {
    try {
        let items = [];

        if (isOnline) {
            const response = await apiFetch('/api/inventory');
            if (!response.ok) throw new Error('Failed to load inventory');
            items = await response.json();
            await saveToIndexedDB(items);
        } else {
            items = await getFromIndexedDB();
            showAlert('Showing offline data - some features may be limited', 'warning');
        }

        displayInventory(items);
        updateLastSync();
    } catch (error) {
        console.error('Error loading inventory:', error);

        const offlineItems = await getFromIndexedDB();
        if (offlineItems.length > 0) {
            displayInventory(offlineItems);
            showAlert('Loaded from offline cache', 'warning');
        } else if (error.message !== 'Session expired') {
            showAlert('Failed to load inventory', 'danger');
        }
    }
}

function displayInventory(items) {
    const tbody = document.getElementById('tableBody');
    const emptyMsg = isViewer
        ? 'No items found'
        : 'Click "Add Item" to get started';

    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-state"><h3>No items found</h3><p>${emptyMsg}</p></td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(item => {
        let lastCol;
        if (isViewer) {
            lastCol = `<td>${item.entry_by ? escapeHtml(item.entry_by) : '-'}</td>`;
        } else {
            const canEdit = isOperator() && item.user_id === currentUser.id;
            lastCol = canEdit
                ? `<td><div class="action-btns">
                    <button class="btn btn-secondary" onclick="openEditModal(${item.id})">Edit</button>
                    <button class="btn btn-danger" onclick="deleteItem(${item.id})">Delete</button>
                   </div></td>`
                : `<td>${item.entry_by ? escapeHtml(item.entry_by) : '-'}</td>`;
        }

        return `
        <tr>
            <td><strong>${escapeHtml(item.description)}</strong></td>
            <td>${item.model ? escapeHtml(item.model) : '-'}</td>
            <td>${item.rv_number ? escapeHtml(item.rv_number) : '-'}</td>
            <td>${item.po_number ? escapeHtml(item.po_number) : '-'}</td>
            <td>${item.location_installed ? escapeHtml(item.location_installed) : '-'}</td>
            <td>${item.amount ? '₱' + formatNumber(item.amount) : '-'}</td>
            <td>${item.date_acquired ? new Date(item.date_acquired).toLocaleDateString() : '-'}</td>
            <td>${item.acquired_by ? escapeHtml(item.acquired_by) : '-'}</td>
            ${lastCol}
        </tr>`;
    }).join('');
}

function filterInventory() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const location = document.getElementById('locationFilter').value.toLowerCase();

    const rows = document.querySelectorAll('#tableBody tr');

    rows.forEach(row => {
        if (row.querySelector('.empty-state')) return;

        const text = row.textContent.toLowerCase();
        const matches = (search === '' || text.includes(search)) &&
                       (location === '' || text.includes(location));

        row.style.display = matches ? '' : 'none';
    });
}

async function loadStats() {
    try {
        if (!isOnline) {
            showAlert('Statistics require online connection', 'warning');
            return;
        }

        const response = await apiFetch('/api/stats');
        if (!response.ok) throw new Error('Failed to load stats');
        const stats = await response.json();

        const statCards = document.querySelectorAll('.stat-card');
        statCards[0].querySelector('.value').textContent = stats.total_items;
        statCards[1].querySelector('.value').textContent = '₱' + formatNumber(stats.total_value);
        statCards[2].querySelector('.value').textContent = stats.locations;
    } catch (error) {
        console.error('Error loading stats:', error);
        if (error.message !== 'Session expired') {
            showAlert('Failed to load statistics', 'danger');
        }
    }
}

async function refreshCurrentUser() {
    const response = await apiFetch('/api/auth/me');
    if (!response.ok) throw new Error('Failed to load profile');
    const data = await response.json();
    currentUser = data.user;
    displayUserInfo();
    return currentUser;
}

// Profile Panel
function getAvatarInitial(name) {
    return name ? name.charAt(0).toUpperCase() : '?';
}

function renderProfileAvatar(user) {
    const preview = document.getElementById('profileAvatarPreview');
    const removeBtn = document.getElementById('removeAvatarBtn');

    if (user.profile_pic) {
        preview.className = 'profile-avatar-preview';
        preview.innerHTML = `<img src="${escapeHtml(user.profile_pic)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
        removeBtn.style.display = 'inline-block';
    } else {
        preview.className = 'profile-avatar-preview placeholder';
        preview.textContent = getAvatarInitial(user.full_name);
        removeBtn.style.display = 'none';
    }
}

function renderDeleteAccountState(user) {
    const warning = document.getElementById('deleteAccountWarning');
    const deleteBtn = document.getElementById('deleteAccountBtn');
    const itemCount = user.item_count || 0;

    if (itemCount > 0) {
        warning.style.display = 'block';
        warning.textContent = `You have ${itemCount} inventory item${itemCount !== 1 ? 's' : ''} listed under your account. Remove or reassign them before deleting your account.`;
        deleteBtn.disabled = true;
    } else {
        warning.style.display = 'none';
        deleteBtn.disabled = false;
    }
}

async function openProfileModal() {
    if (isViewer) return;
    if (!isOnline) {
        showAlert('Profile editing requires an online connection', 'warning');
        return;
    }

    try {
        const user = await refreshCurrentUser();

        document.getElementById('profileUsername').value = user.username;
        document.getElementById('profileFullName').value = user.full_name;
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        document.getElementById('deletePassword').value = '';

        const meta = document.getElementById('profileMeta');
        const memberSince = user.created_at
            ? new Date(user.created_at).toLocaleDateString()
            : 'Unknown';
        meta.innerHTML = `
            <span>@${escapeHtml(user.username)}</span>
            <span>${user.item_count || 0} item${user.item_count !== 1 ? 's' : ''} listed</span>
            <span>Member since ${memberSince}</span>
        `;

        renderProfileAvatar(user);
        renderDeleteAccountState(user);
        document.getElementById('profileModal').classList.add('show');
    } catch (error) {
        console.error('Error opening profile:', error);
        if (error.message !== 'Session expired') {
            showAlert('Failed to load profile', 'danger');
        }
    }
}

function closeProfileModal() {
    document.getElementById('profileModal').classList.remove('show');
    const avatarInput = document.getElementById('avatarInput');
    if (avatarInput) avatarInput.value = '';
}

async function handleProfileSubmit(e) {
    e.preventDefault();

    const username = document.getElementById('profileUsername').value.trim();
    const full_name = document.getElementById('profileFullName').value.trim();

    try {
        const response = await apiFetch('/api/auth/me', {
            method: 'PATCH',
            body: JSON.stringify({ username, full_name })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to update profile');

        currentUser = data.user;
        displayUserInfo();
        renderProfileAvatar(currentUser);
        document.getElementById('profileMeta').innerHTML = `
            <span>@${escapeHtml(currentUser.username)}</span>
            <span>${currentUser.item_count || 0} item${currentUser.item_count !== 1 ? 's' : ''} listed</span>
            <span>Member since ${currentUser.created_at ? new Date(currentUser.created_at).toLocaleDateString() : 'Unknown'}</span>
        `;
        showAlert('Profile updated successfully!', 'success');
    } catch (error) {
        console.error('Error updating profile:', error);
        if (error.message !== 'Session expired') {
            showAlert(error.message, 'danger');
        }
    }
}

async function handlePasswordSubmit(e) {
    e.preventDefault();

    const current_password = document.getElementById('currentPassword').value;
    const new_password = document.getElementById('newPassword').value;
    const confirm_password = document.getElementById('confirmPassword').value;

    if (new_password !== confirm_password) {
        showAlert('New passwords do not match', 'danger');
        return;
    }

    try {
        const response = await apiFetch('/api/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ current_password, new_password })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to change password');

        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        showAlert('Password changed successfully!', 'success');
    } catch (error) {
        console.error('Error changing password:', error);
        if (error.message !== 'Session expired') {
            showAlert(error.message, 'danger');
        }
    }
}

async function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('avatar', file);

    try {
        const response = await fetch('/api/auth/me/avatar', {
            method: 'POST',
            credentials: 'same-origin',
            body: formData
        });

        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to upload photo');

        currentUser = data.user;
        displayUserInfo();
        renderProfileAvatar(currentUser);
        showAlert('Profile picture updated!', 'success');
    } catch (error) {
        console.error('Error uploading avatar:', error);
        showAlert(error.message, 'danger');
    } finally {
        e.target.value = '';
    }
}

async function removeAvatar() {
    if (!confirm('Remove your profile picture?')) return;

    try {
        const response = await apiFetch('/api/auth/me/avatar', { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to remove photo');

        currentUser = data.user;
        displayUserInfo();
        renderProfileAvatar(currentUser);
        showAlert('Profile picture removed', 'success');
    } catch (error) {
        console.error('Error removing avatar:', error);
        if (error.message !== 'Session expired') {
            showAlert(error.message, 'danger');
        }
    }
}

// Admin Panel
async function loadAdminUsers() {
    const container = document.getElementById('adminUsersList');
    container.innerHTML = '<p class="empty-state">Loading users...</p>';

    try {
        const response = await apiFetch('/api/admin/users');
        if (!response.ok) throw new Error('Failed to load users');
        const users = await response.json();

        if (users.length === 0) {
            container.innerHTML = '<p class="empty-state">No users found</p>';
            return;
        }

        container.innerHTML = users.map(user => `
            <div class="admin-user-card" id="user-card-${user.id}">
                <div class="admin-user-header" onclick="toggleUserInventory(${user.id})">
                    <div class="admin-user-meta">
                        <strong>${escapeHtml(user.full_name)}</strong>
                        <span style="color: #95a5a6; font-size: 13px;">@${escapeHtml(user.username)}</span>
                        <span class="role-badge ${user.role === 'super_admin' ? 'admin' : ''}">${escapeHtml(user.role || 'admin')}</span>
                    </div>
                    <div class="admin-user-stats">
                        <span>${user.item_count} item${user.item_count !== 1 ? 's' : ''}</span>
                        <span>₱${formatNumber(user.total_value || 0)}</span>
                        <span id="toggle-icon-${user.id}">▼</span>
                    </div>
                </div>
                <div class="admin-inventory-panel" id="user-inventory-${user.id}">
                    <p class="empty-state" style="padding: 20px;">Click to load inventory...</p>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading admin users:', error);
        container.innerHTML = '<p class="empty-state">Failed to load users</p>';
    }
}

async function toggleUserInventory(userId) {
    const panel = document.getElementById(`user-inventory-${userId}`);
    const icon = document.getElementById(`toggle-icon-${userId}`);

    if (panel.classList.contains('show')) {
        panel.classList.remove('show');
        icon.textContent = '▼';
        return;
    }

    panel.classList.add('show');
    icon.textContent = '▲';
    panel.innerHTML = '<p class="empty-state" style="padding: 20px;">Loading inventory...</p>';

    try {
        const response = await apiFetch(`/api/admin/users/${userId}/inventory`);
        if (!response.ok) throw new Error('Failed to load user inventory');
        const data = await response.json();

        if (data.items.length === 0) {
            panel.innerHTML = '<p class="empty-state" style="padding: 20px;">No inventory items entered by this user</p>';
            return;
        }

        panel.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Description</th>
                        <th>Model</th>
                        <th>RV#</th>
                        <th>Location</th>
                        <th>Amount</th>
                        <th>Acquired By</th>
                        <th>Date Entry</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.items.map(item => `
                        <tr>
                            <td>${escapeHtml(item.description)}</td>
                            <td>${item.model ? escapeHtml(item.model) : '-'}</td>
                            <td>${item.rv_number ? escapeHtml(item.rv_number) : '-'}</td>
                            <td>${item.location_installed ? escapeHtml(item.location_installed) : '-'}</td>
                            <td>${item.amount ? '₱' + formatNumber(item.amount) : '-'}</td>
                            <td>${item.acquired_by ? escapeHtml(item.acquired_by) : '-'}</td>
                            <td>${item.date_entry ? new Date(item.date_entry).toLocaleDateString() : '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error('Error loading user inventory:', error);
        panel.innerHTML = '<p class="empty-state" style="padding: 20px;">Failed to load inventory</p>';
    }
}

async function handleCreateAdmin(e) {
    e.preventDefault();
    const btn = document.getElementById('createAdminBtn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
        const response = await apiFetch('/api/admin/users', {
            method: 'POST',
            body: JSON.stringify({
                full_name: document.getElementById('newAdminFullName').value.trim(),
                username: document.getElementById('newAdminUsername').value.trim(),
                password: document.getElementById('newAdminPassword').value
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to create admin');

        document.getElementById('createAdminForm').reset();
        showAlert('Admin account created successfully!', 'success');
        loadAdminUsers();
    } catch (error) {
        console.error('Error creating admin:', error);
        if (error.message !== 'Session expired') {
            showAlert(error.message, 'danger');
        }
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Admin';
    }
}

async function loadDeletedLogs() {
    const tbody = document.getElementById('logsTableBody');
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><h3>Loading...</h3></td></tr>';

    try {
        const response = await apiFetch('/api/logs/deleted');
        if (!response.ok) throw new Error('Failed to load logs');
        const logs = await response.json();

        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><h3>No deleted items</h3></td></tr>';
            return;
        }

        tbody.innerHTML = logs.map(log => `
            <tr>
                <td><strong>${escapeHtml(log.description || '-')}</strong></td>
                <td>${log.rv_number ? escapeHtml(log.rv_number) : '-'}</td>
                <td>${log.entry_by ? escapeHtml(log.entry_by) : '-'}</td>
                <td>${log.deleted_by ? escapeHtml(log.deleted_by) : '-'}</td>
                <td>${log.deleted_at ? new Date(log.deleted_at).toLocaleString() : '-'}</td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading logs:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><h3>Failed to load logs</h3></td></tr>';
    }
}

function openAddModal() {
    if (!isOperator()) return;
    currentEditId = null;
    document.getElementById('modalTitle').textContent = 'Add New Item';
    document.getElementById('itemForm').reset();
    document.getElementById('itemModal').classList.add('show');
}

async function openEditModal(id) {
    if (!isOperator()) return;
    try {
        if (!isOnline) {
            showAlert('Editing requires online connection', 'warning');
            return;
        }

        const response = await apiFetch(`/api/inventory/${id}`);
        if (!response.ok) throw new Error('Failed to load item');
        const item = await response.json();

        currentEditId = id;
        document.getElementById('modalTitle').textContent = 'Edit Item';

        document.getElementById('description').value = item.description;
        document.getElementById('model').value = item.model || '';
        document.getElementById('specs').value = item.specs || '';
        document.getElementById('rvNumber').value = item.rv_number || '';
        document.getElementById('poNumber').value = item.po_number || '';
        document.getElementById('dateAcquired').value = item.date_acquired || '';
        document.getElementById('amount').value = item.amount || '';
        document.getElementById('acquiredBy').value = item.acquired_by || '';
        document.getElementById('locationInstalled').value = item.location_installed || '';
        document.getElementById('remarks').value = item.remarks || '';

        document.getElementById('itemModal').classList.add('show');
    } catch (error) {
        console.error('Error loading item:', error);
        if (error.message !== 'Session expired') {
            showAlert('Failed to load item', 'danger');
        }
    }
}

function closeModal() {
    document.getElementById('itemModal').classList.remove('show');
    currentEditId = null;
}

async function handleFormSubmit(e) {
    e.preventDefault();
    if (!isOperator()) return;

    if (!isOnline && !currentEditId) {
        showAlert('Adding new items requires online connection', 'warning');
        return;
    }

    const formData = {
        description: document.getElementById('description').value,
        model: document.getElementById('model').value,
        specs: document.getElementById('specs').value,
        rv_number: document.getElementById('rvNumber').value,
        po_number: document.getElementById('poNumber').value,
        date_acquired: document.getElementById('dateAcquired').value,
        amount: parseFloat(document.getElementById('amount').value),
        acquired_by: document.getElementById('acquiredBy').value,
        location_installed: document.getElementById('locationInstalled').value,
        remarks: document.getElementById('remarks').value,
        date_entry: new Date().toISOString()
    };

    try {
        const method = currentEditId ? 'PUT' : 'POST';
        const url = currentEditId ? `/api/inventory/${currentEditId}` : '/api/inventory';

        const response = await apiFetch(url, {
            method: method,
            body: JSON.stringify(formData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save item');
        }

        showAlert(currentEditId ? 'Item updated successfully!' : 'Item added successfully!', 'success');
        closeModal();
        loadInventory();
        loadStats();
    } catch (error) {
        console.error('Error saving item:', error);
        if (error.message !== 'Session expired') {
            showAlert(error.message, 'danger');
        }
    }
}

async function deleteItem(id) {
    if (!isOperator()) return;
    if (!confirm('Are you sure you want to delete this item?')) return;

    try {
        if (!isOnline) {
            showAlert('Deleting items requires online connection', 'warning');
            return;
        }

        const response = await apiFetch(`/api/inventory/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete item');

        // Delete from IndexedDB cache
        await deleteFromIndexedDB(id);

        showAlert('Item deleted successfully!', 'success');
        loadInventory();
        loadStats();
    } catch (error) {
        console.error('Error deleting item:', error);
        if (error.message !== 'Session expired') {
            showAlert(error.message, 'danger');
        }
    }
}

// --- Modified exportData to accept category/type and call filtered endpoint ---
async function exportData(type = 'all') {
    if (!isOperator()) return;
    try {
        if (!isOnline) {
            showAlert('Export requires online connection', 'warning');
            return;
        }

        const url = `/api/inventory/export/csv?type=${encodeURIComponent(type)}`;
        const response = await fetch(url, { credentials: 'same-origin' });
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        if (!response.ok) throw new Error('Failed to export data');

        const csv = await response.text();

        const blob = new Blob([csv], { type: 'text/csv' });
        const urlBlob = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = urlBlob;
        a.download = `inventory_${type}_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(urlBlob);
        document.body.removeChild(a);

        showAlert('Data exported successfully!', 'success');
    } catch (error) {
        console.error('Error exporting data:', error);
        showAlert('Failed to export data', 'danger');
    }
}

// --- Modified printInventory to fetch filtered JSON and build printable table ---
async function printInventory(type = 'all') {
    if (!isOperator()) return;
    try {
        if (!isOnline) {
            showAlert('Print requires online connection', 'warning');
            return;
        }

        const resp = await apiFetch(`/api/inventory?type=${encodeURIComponent(type)}`);
        if (!resp.ok) {
            if (resp.status === 401) { window.location.href = '/login'; return; }
            throw new Error('Failed to load inventory for printing');
        }
        const items = await resp.json();

        const rows = items.map(it => `
            <tr>
                <td>${escapeHtml(it.description || '')}</td>
                <td>${escapeHtml(it.model || '')}</td>
                <td>${escapeHtml(it.rv_number || '')}</td>
                <td>${escapeHtml(it.po_number || '')}</td>
                <td>${escapeHtml(it.location_installed || '')}</td>
                <td>${escapeHtml(it.amount || '')}</td>
                <td>${escapeHtml(it.date_acquired || '')}</td>
                <td>${escapeHtml(it.acquired_by || '')}</td>
            </tr>
        `).join('');

        const tableHtml = `
            <table>
                <thead>
                    <tr>
                        <th>Description</th><th>Model</th><th>RV#</th><th>PO#</th>
                        <th>Location</th><th>Amount</th><th>Date Acquired</th><th>Acquired By</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;

        const printWindow = window.open('', '', 'width=1200,height=600');
        printWindow.document.write(`
            <html><head>
            <title>IT Equipment Inventory Report</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                h1 { color: #2c3e50; }
                table { width: 100%; border-collapse: collapse; }
                th, td { padding: 10px; border: 1px solid #ddd; text-align: left; }
                th { background-color: #2c3e50; color: white; }
                tr:nth-child(even) { background-color: #f9f9f9; }
            </style></head>
            <body>
                <h1>IT Equipment Inventory Report</h1>
                <p>Category: ${escapeHtml(type)}</p>
                <p>Generated: ${new Date().toLocaleString()}</p>
                ${tableHtml}
            </body></html>
        `);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        printWindow.close();
    } catch (error) {
        console.error('Error printing inventory:', error);
        showAlert('Failed to print inventory', 'danger');
    }
}

function showAlert(message, type = 'info') {
    const alert = document.getElementById('alert');
    alert.textContent = message;
    alert.className = `alert alert-${type} show`;

    setTimeout(() => {
        alert.classList.remove('show');
    }, 5000);
}

function formatNumber(num) {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(num);
}

function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

function updateLastSync() {
    document.getElementById('lastSync').textContent = new Date().toLocaleTimeString();
}

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        if (isOperator()) openAddModal();
    }
    if (e.key === 'Escape') {
        closeModal();
        closeProfileModal();
    }
});
