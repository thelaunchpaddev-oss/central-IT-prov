/* ==========================================================================
   CENTRAL IT - ENTERPRISE OPERATIONS HUB CONTROLLER
   Complete & Verified End-to-End Against server.js
   ========================================================================== */

let currentUser = null;
let currentUserRole = 'VIEWER';
let currentUserId = null;
let currentSiteId = null;

let allSitesCache = [];
let allAssetsCache = [];
let allEmployeesCache = [];
let allTeamsCache = [];
let stagedAssetsCache = [];
let allSystemUsersCache = [];

const modal = document.getElementById('appModal');
const modalWrapper = document.getElementById('modalContentWrapper');

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
}

/* =========================================================
   INITIALIZATION & SESSION BINDING
   ========================================================= */
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const sessionRes = await fetch('/api/session');
        if (!sessionRes.ok) {
            window.location.href = '/login.html';
            return;
        }
        currentUser = await sessionRes.json();
        currentUserRole = currentUser.role || 'VIEWER';
        currentUserId = currentUser.id;

        const initials = escapeHTML(currentUser.name).split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        
        const avatarEl = document.querySelector('.user-avatar');
        const nameEl = document.querySelector('.user-name');
        const roleEl = document.querySelector('.user-role');

        if (avatarEl) avatarEl.innerText = initials;
        if (nameEl) nameEl.innerText = escapeHTML(currentUser.name);
        if (roleEl) roleEl.innerText = currentUserRole === 'ADMIN' ? 'Administrator' : currentUserRole === 'STAFF' ? 'IT Staff' : 'Viewer';

        if (currentUserRole === 'ADMIN') {
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex');
        } else {
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
        }

        if (currentUserRole !== 'VIEWER') {
            document.querySelectorAll('.role-protected').forEach(el => el.style.display = 'flex');
        } else {
            document.querySelectorAll('.role-protected').forEach(el => el.style.display = 'none');
        }
    } catch (err) {
        console.error('Session initialization failed:', err);
        window.location.href = '/login.html';
        return;
    }

    // Bind Profile Dropdown Toggle & Sign Out
    const profileMenu = document.getElementById('userProfileMenu');
    const profileDropdown = document.getElementById('profileDropdown');

    if (profileMenu && profileDropdown) {
        profileMenu.addEventListener('click', (e) => {
            if (e.target.closest('#profileDropdown')) return;
            e.stopPropagation();
            profileDropdown.classList.toggle('show');
        });

        document.addEventListener('click', (e) => {
            if (!profileMenu.contains(e.target)) {
                profileDropdown.classList.remove('show');
            }
        });
    }

    const signOutBtn = document.getElementById('btnSignOut');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            logoutUser();
        });
    }

    // Close Modal on Backdrop Click
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    }

    // Load Global Site Context & Initial Data
    await loadGlobalSites();
    await refreshActiveSiteData();
});

async function logoutUser() {
    try {
        await fetch('/api/logout', { method: 'POST' });
    } catch (err) {
        console.error('Logout error:', err);
    } finally {
        window.location.href = '/login.html';
    }
}
window.logoutUser = logoutUser;

function openCurrentProfile(e) {
    if (e) e.stopPropagation();
    const dropdown = document.getElementById('profileDropdown');
    if (dropdown) dropdown.classList.remove('show');

    if (!currentUser || !modalWrapper || !modal) return;
    modalWrapper.innerHTML = `
        <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 12px;">Active Session Profile</h3>
        <div style="background: #F8FAFC; border: 1px solid var(--border-color); border-radius: 4px; padding: 12px; margin-bottom: 16px; font-size: 12.5px;">
            <p style="margin-bottom: 6px;"><strong>Full Name:</strong> ${escapeHTML(currentUser.name)}</p>
            <p style="margin-bottom: 6px;"><strong>Email:</strong> ${escapeHTML(currentUser.email)}</p>
            <p style="margin-bottom: 0;"><strong>Access Role:</strong> <span class="badge ${currentUserRole.toLowerCase()}">${escapeHTML(currentUserRole)}</span></p>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <button type="button" class="btn btn-secondary" onclick="closeModal()">Close</button>
            <button type="button" class="btn btn-danger" onclick="logoutUser()">Sign Out</button>
        </div>
    `;
    modal.style.display = 'flex';
}
window.openCurrentProfile = openCurrentProfile;

/* =========================================================
   SITE SCOPING & NAVIGATION
   ========================================================= */
async function loadGlobalSites() {
    try {
        const res = await fetch('/api/sites');
        if (!res.ok) return;
        allSitesCache = await res.json();
        
        const selectEl = document.getElementById('globalSiteSelector');
        if (!selectEl) return;
        
        if (!allSitesCache || allSitesCache.length === 0) {
            selectEl.innerHTML = `<option value="">No Sites Assigned</option>`;
            currentSiteId = null;
            return;
        }

        selectEl.innerHTML = allSitesCache.map(s => `<option value="${s.id}">${escapeHTML(s.site_code)} - ${escapeHTML(s.site_name)}</option>`).join('');
        
        const cachedSite = localStorage.getItem('preferredSiteId');
        if (cachedSite && allSitesCache.some(s => String(s.id) === String(cachedSite))) {
            currentSiteId = cachedSite;
        } else {
            currentSiteId = allSitesCache[0].id;
        }
        selectEl.value = currentSiteId;
    } catch (err) {
        console.error('Failed to load sites:', err);
    }
}

async function switchGlobalSite(siteId) {
    if (!siteId) return;
    currentSiteId = siteId;
    localStorage.setItem('preferredSiteId', siteId);
    await refreshActiveSiteData();
}
window.switchGlobalSite = switchGlobalSite;

async function refreshActiveSiteData() {
    await Promise.all([
        loadOverviewTelemetry(),
        loadAssets(),
        loadEmployees(),
        loadTeams()
    ]);
    if (currentUserRole === 'ADMIN') {
        loadStagingData();
        loadSystemUsers();
    }
    loadSitesTable();
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => el.classList.remove('active'));

    const targetTab = document.getElementById(`tab-${tabId}`);
    if (targetTab) targetTab.style.display = 'block';

    const activeBtn = Array.from(document.querySelectorAll('.sidebar-nav .nav-item')).find(btn => btn.getAttribute('onclick')?.includes(`'${tabId}'`));
    if (activeBtn) activeBtn.classList.add('active');

    const titleMap = {
        'overview': 'Command Overview',
        'assets': 'Asset Inventory',
        'import': 'Bulk Import & Staging',
        'maintenance': 'Maintenance Queue',
        'directory': 'Staff Directory',
        'sites': 'Site & Locations',
        'governance': 'User Governance'
    };

    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.innerText = titleMap[tabId] || 'Command Overview';

    if (tabId === 'overview') loadOverviewTelemetry();
    if (tabId === 'assets' || tabId === 'maintenance') loadAssets();
    if (tabId === 'import') loadStagingData();
    if (tabId === 'directory') { loadEmployees(); loadTeams(); }
    if (tabId === 'sites') loadSitesTable();
    if (tabId === 'governance') loadSystemUsers();
}
window.switchTab = switchTab;

function switchSubTab(subTabId) {
    document.querySelectorAll('.sub-tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.sub-tab-btn').forEach(el => el.classList.remove('active'));

    const targetSubTab = document.getElementById(`subtab-${subTabId}`);
    if (targetSubTab) targetSubTab.style.display = 'block';

    const activeBtn = Array.from(document.querySelectorAll('.sub-tab-btn')).find(btn => btn.getAttribute('onclick')?.includes(`'${subTabId}'`));
    if (activeBtn) activeBtn.classList.add('active');
}
window.switchSubTab = switchSubTab;

function closeModal() {
    if (modal) modal.style.display = 'none';
}
window.closeModal = closeModal;

function showNoticeModal(title, message) {
    if (!modalWrapper || !modal) return;
    modalWrapper.innerHTML = `
        <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 8px;">${escapeHTML(title)}</h3>
        <p style="font-size: 12.5px; color: var(--text-secondary); margin-bottom: 18px; line-height: 1.5;">${escapeHTML(message)}</p>
        <div style="display: flex; justify-content: flex-end;">
            <button type="button" onclick="closeModal()" class="btn btn-primary">OK</button>
        </div>
    `;
    modal.style.display = 'flex';
}
window.showNoticeModal = showNoticeModal;

/* =========================================================
   1. COMMAND OVERVIEW & ANALYTICS
   ========================================================= */
async function loadOverviewTelemetry() {
    if (!currentSiteId) return;
    try {
        const res = await fetch(`/api/assets?site_id=${currentSiteId}`);
        if (!res.ok) return;
        const assets = await res.json();
        allAssetsCache = assets;

        document.getElementById('statTotalAssets').innerText = assets.length;
        document.getElementById('statAssignedAssets').innerText = assets.filter(a => a.status === 'Assigned').length;
        document.getElementById('statWfhAssets').innerText = assets.filter(a => a.category === 'Monitor').length;
        document.getElementById('statMaintAssets').innerText = assets.filter(a => a.status === 'In Maintenance').length;

        const total = assets.length;
        const laptops = assets.filter(a => a.category === 'Laptop').length;
        const monitors = assets.filter(a => a.category === 'Monitor').length;
        const peripherals = assets.filter(a => a.category !== 'Laptop' && a.category !== 'Monitor').length;

        const lapPct = total > 0 ? Math.round((laptops / total) * 100) : 0;
        const monPct = total > 0 ? Math.round((monitors / total) * 100) : 0;
        const perPct = total > 0 ? Math.round((peripherals / total) * 100) : 0;

        document.getElementById('donutTotalCount').innerText = total;
        document.getElementById('legendLaptopsPct').innerText = `${lapPct}%`;
        document.getElementById('legendMonitorsPct').innerText = `${monPct}%`;
        document.getElementById('legendPeripheralsPct').innerText = `${perPct}%`;

        const segLaptops = document.getElementById('donutSegmentLaptops');
        const segMonitors = document.getElementById('donutSegmentMonitors');
        const segPeripherals = document.getElementById('donutSegmentPeripherals');

        let offset = 25;
        if (segLaptops) {
            segLaptops.setAttribute('stroke-dasharray', `${lapPct} ${100 - lapPct}`);
            segLaptops.setAttribute('stroke-dashoffset', offset);
            offset -= lapPct;
        }
        if (segMonitors) {
            segMonitors.setAttribute('stroke-dasharray', `${monPct} ${100 - monPct}`);
            segMonitors.setAttribute('stroke-dashoffset', offset);
            offset -= monPct;
        }
        if (segPeripherals) {
            segPeripherals.setAttribute('stroke-dasharray', `${perPct} ${100 - perPct}`);
            segPeripherals.setAttribute('stroke-dashoffset', offset);
        }

        document.getElementById('barLaptopsPctText').innerText = `${lapPct}%`;
        document.getElementById('barMonitorsPctText').innerText = `${monPct}%`;
        document.getElementById('barPeripheralsPctText').innerText = `${perPct}%`;

        document.getElementById('barFillLaptops').style.width = `${lapPct}%`;
        document.getElementById('barFillMonitors').style.width = `${monPct}%`;
        document.getElementById('barFillPeripherals').style.width = `${perPct}%`;

        // Fetch Model Counts & Warranty Health
        const [modelsRes, warrantyRes] = await Promise.all([
            fetch(`/api/analytics/models?site_id=${currentSiteId}`),
            fetch(`/api/analytics/warranty-expirations?site_id=${currentSiteId}&days=60`)
        ]);

        if (modelsRes.ok) {
            const models = await modelsRes.json();
            const modelContainer = document.getElementById('modelBreakdownContainer');
            if (modelContainer) {
                if (models.length === 0) {
                    modelContainer.innerHTML = `<p style="font-size: 12px; color: var(--text-secondary);">No hardware models registered for this site.</p>`;
                } else {
                    modelContainer.innerHTML = models.map(m => `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--border-color);">
                            <div>
                                <strong style="font-size: 12.5px; color: var(--text-primary); display: block;">${escapeHTML(m.model)}</strong>
                                <span style="font-size: 10.5px; color: var(--text-secondary);">${escapeHTML(m.category)}</span>
                            </div>
                            <span class="badge staff">${m.count} unit(s)</span>
                        </div>
                    `).join('');
                }
            }
        }

        if (warrantyRes.ok) {
            const wData = await warrantyRes.json();
            document.getElementById('statWarrantyActive').innerText = `Active: ${wData.activeCount}`;
            document.getElementById('statWarrantyExpiring').innerText = `Expiring Soon: ${wData.expiringSoonCount}`;
            document.getElementById('statWarrantyExpired').innerText = `Expired: ${wData.expiredCount}`;

            const listContainer = document.getElementById('warrantyAlertList');
            if (listContainer) {
                if (!wData.items || wData.items.length === 0) {
                    listContainer.innerHTML = `<p style="font-size: 12px; color: var(--text-secondary);">No laptop warranties recorded for this site.</p>`;
                } else {
                    listContainer.innerHTML = wData.items.map(l => {
                        const badgeClass = l.warrantyStatus === 'Active' ? 'open' : l.warrantyStatus === 'Expiring Soon' ? 'warning' : l.warrantyStatus === 'Expired' ? 'high' : 'viewer';
                        const daysText = l.daysRemaining !== null ? (l.daysRemaining < 0 ? `${Math.abs(l.daysRemaining)}d ago` : `in ${l.daysRemaining}d`) : 'No End Date';
                        return `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--border-color);">
                                <div>
                                    <strong style="font-size: 12px; color: var(--text-primary); display: block;">${escapeHTML(l.assetTag)} (${escapeHTML(l.model || 'Laptop')})</strong>
                                    <span style="font-size: 10.5px; color: var(--text-secondary);">Assigned: ${escapeHTML(l.assignedEmployeeName)}</span>
                                </div>
                                <div style="text-align: right;">
                                    <span class="badge ${badgeClass}">${escapeHTML(l.warrantyStatus)}</span>
                                    <span style="display: block; font-size: 10px; color: var(--text-secondary); margin-top: 2px;">${daysText}</span>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }
        }
    } catch (err) {
        console.error('Overview telemetry error:', err);
    }
}

async function syncDellWarranties() {
    if (!currentSiteId) return;
    showNoticeModal('Dell TechDirect Sync', 'Connecting to Dell API to verify Service Tag entitlements...');
    try {
        const res = await fetch(`/api/integrations/dell/sync?site_id=${currentSiteId}`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            showNoticeModal('Dell Sync Complete', `Updated ${data.updatedCount || 0} Dell laptop warranty record(s).`);
            await loadOverviewTelemetry();
        } else {
            showNoticeModal('Dell Integration Status', data.message || 'Unable to synchronize Dell API.');
        }
    } catch (err) {
        showNoticeModal('Network Error', 'Failed to reach Dell sync endpoint.');
    }
}
window.syncDellWarranties = syncDellWarranties;

/* =========================================================
   2. ASSET INVENTORY & MAINTENANCE QUEUE
   ========================================================= */
async function loadAssets() {
    if (!currentSiteId) return;
    try {
        const res = await fetch(`/api/assets?site_id=${currentSiteId}`);
        if (!res.ok) return;
        allAssetsCache = await res.json();

        const laptops = allAssetsCache.filter(a => a.category === 'Laptop');
        const monitors = allAssetsCache.filter(a => a.category === 'Monitor');
        const peripherals = allAssetsCache.filter(a => a.category !== 'Laptop' && a.category !== 'Monitor');
        const maintenance = allAssetsCache.filter(a => a.status === 'In Maintenance');

        const canEdit = currentUserRole !== 'VIEWER';

        // Render Laptops
        const laptopBody = document.getElementById('laptopTableBody');
        if (laptopBody) {
            laptopBody.innerHTML = laptops.length === 0 ? `<tr><td colspan="8" style="text-align:center; color:var(--text-secondary);">No laptops registered at this site.</td></tr>` :
            laptops.map(a => {
                const wStatus = getWarrantyStatusLabel(a.warrantyEnd);
                return `
                <tr>
                    <td><strong>${escapeHTML(a.assetTag)}</strong></td>
                    <td>${escapeHTML(a.model)}</td>
                    <td>${escapeHTML(a.serialNumber)}</td>
                    <td><span class="badge ${a.status === 'Assigned' ? 'staff' : a.status === 'In Maintenance' ? 'high' : 'open'}">${escapeHTML(a.status)}</span></td>
                    <td>${escapeHTML(a.assignedEmployeeName || 'Unassigned')}</td>
                    <td>${a.warrantyStart || '—'} to ${a.warrantyEnd || '—'}</td>
                    <td><span class="badge ${wStatus.badge}">${wStatus.text}</span></td>
                    <td style="text-align: right;">
                        ${canEdit ? `<button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="openEditAssetModal(${a.id})">Edit</button>` : '—'}
                    </td>
                </tr>`;
            }).join('');
        }

        // Render Monitors
        const monitorBody = document.getElementById('monitorTableBody');
        if (monitorBody) {
            monitorBody.innerHTML = monitors.length === 0 ? `<tr><td colspan="7" style="text-align:center; color:var(--text-secondary);">No monitors registered at this site.</td></tr>` :
            monitors.map(a => `
                <tr>
                    <td><strong>${escapeHTML(a.assetTag)}</strong></td>
                    <td>${escapeHTML(a.model)}</td>
                    <td>${escapeHTML(a.serialNumber)}</td>
                    <td>${escapeHTML(a.location || 'Office')}</td>
                    <td><span class="badge ${a.status === 'Assigned' ? 'staff' : a.status === 'In Maintenance' ? 'high' : 'open'}">${escapeHTML(a.status)}</span></td>
                    <td>${escapeHTML(a.assignedEmployeeName || 'Unassigned')}</td>
                    <td style="text-align: right;">
                        ${canEdit ? `<button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="openEditAssetModal(${a.id})">Edit</button>` : '—'}
                    </td>
                </tr>`).join('');
        }

        // Render Peripherals
        const peripheralBody = document.getElementById('peripheralTableBody');
        if (peripheralBody) {
            peripheralBody.innerHTML = peripherals.length === 0 ? `<tr><td colspan="6" style="text-align:center; color:var(--text-secondary);">No peripherals registered at this site.</td></tr>` :
            peripherals.map(a => `
                <tr>
                    <td><strong>${escapeHTML(a.assetTag)}</strong></td>
                    <td>${escapeHTML(a.category)} - ${escapeHTML(a.model)}</td>
                    <td>${escapeHTML(a.serialNumber)}</td>
                    <td><span class="badge ${a.status === 'Assigned' ? 'staff' : a.status === 'In Maintenance' ? 'high' : 'open'}">${escapeHTML(a.status)}</span></td>
                    <td>${escapeHTML(a.assignedEmployeeName || 'Unassigned')}</td>
                    <td style="text-align: right;">
                        ${canEdit ? `<button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="openEditAssetModal(${a.id})">Edit</button>` : '—'}
                    </td>
                </tr>`).join('');
        }

        // Render Maintenance Queue
        const maintBody = document.getElementById('maintenanceTableBody');
        if (maintBody) {
            maintBody.innerHTML = maintenance.length === 0 ? `<tr><td colspan="5" style="text-align:center; color:var(--text-secondary);">No hardware currently in the maintenance queue.</td></tr>` :
            maintenance.map(a => `
                <tr>
                    <td><strong>${escapeHTML(a.assetTag)}</strong></td>
                    <td>${escapeHTML(a.category)} - ${escapeHTML(a.model)}</td>
                    <td>${escapeHTML(a.serialNumber)}</td>
                    <td><span class="badge high">In Maintenance</span></td>
                    <td style="text-align: right;">
                        ${canEdit ? `<button class="btn btn-primary" style="padding: 3px 8px; font-size: 11px;" onclick="restoreFromMaintenance(${a.id})">Mark Repaired</button>` : '—'}
                    </td>
                </tr>`).join('');
        }
    } catch (err) {
        console.error('Failed to load assets:', err);
    }
}

function getWarrantyStatusLabel(warrantyEnd) {
    if (!warrantyEnd) return { text: 'No Info', badge: 'viewer' };
    const end = new Date(warrantyEnd);
    const today = new Date();
    const diffDays = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { text: 'Expired', badge: 'high' };
    if (diffDays <= 60) return { text: 'Expiring Soon', badge: 'warning' };
    return { text: 'Active', badge: 'open' };
}

function openAssetModal() {
    if (!modalWrapper || !modal) return;
    const empOptions = allEmployeesCache.map(e => `<option value="${e.id}">${escapeHTML(e.name)} (${escapeHTML(e.email)})</option>`).join('');

    modalWrapper.innerHTML = `
        <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 14px;">Register Hardware Asset</h3>
        <form onsubmit="submitNewAsset(event)">
            <div class="form-row">
                <div class="form-group">
                    <label>Category</label>
                    <select id="assetCat" required>
                        <option value="Laptop">Laptop</option>
                        <option value="Monitor">Monitor</option>
                        <option value="Peripheral">Peripheral</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Deployment Setup</label>
                    <select id="assetLoc">
                        <option value="Office">Office</option>
                        <option value="Work From Home">Work From Home</option>
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Asset Tag</label>
                    <input type="text" id="assetTag" required placeholder="e.g. PH-LAP-010">
                </div>
                <div class="form-group">
                    <label>Serial / Service Tag</label>
                    <input type="text" id="assetSerial" required placeholder="e.g. 8H92KL3">
                </div>
            </div>
            <div class="form-group">
                <label>Hardware Model</label>
                <input type="text" id="assetModel" required placeholder="e.g. Dell Latitude 5440">
            </div>
            <div class="form-group">
                <label>Assign to Staff (Optional)</label>
                <select id="assetEmp">
                    <option value="">-- Unassigned (In Stock) --</option>
                    ${empOptions}
                </select>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Warranty Start</label>
                    <input type="date" id="assetWStart">
                </div>
                <div class="form-group">
                    <label>Warranty End</label>
                    <input type="date" id="assetWEnd">
                </div>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Register Asset</button>
            </div>
        </form>
    `;
    modal.style.display = 'flex';
}
window.openAssetModal = openAssetModal;

async function submitNewAsset(e) {
    e.preventDefault();
    const payload = {
        category: document.getElementById('assetCat').value,
        location: document.getElementById('assetLoc').value,
        assetTag: document.getElementById('assetTag').value.trim(),
        serialNumber: document.getElementById('assetSerial').value.trim(),
        model: document.getElementById('assetModel').value.trim(),
        assignedEmployeeId: document.getElementById('assetEmp').value || null,
        warrantyStart: document.getElementById('assetWStart').value || null,
        warrantyEnd: document.getElementById('assetWEnd').value || null,
        site_id: currentSiteId
    };

    const res = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (res.ok) {
        closeModal();
        await loadAssets();
        await loadOverviewTelemetry();
    } else {
        const err = await res.json();
        alert(err.error || 'Failed to register asset.');
    }
}
window.submitNewAsset = submitNewAsset;

function openEditAssetModal(assetId) {
    const asset = allAssetsCache.find(a => a.id === assetId);
    if (!asset || !modalWrapper || !modal) return;

    const empOptions = allEmployeesCache.map(e => 
        `<option value="${e.id}" ${asset.assignedEmployeeId === e.id ? 'selected' : ''}>${escapeHTML(e.name)}</option>`
    ).join('');

    modalWrapper.innerHTML = `
        <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 14px;">Edit Asset: ${escapeHTML(asset.assetTag)}</h3>
        <form onsubmit="submitEditAsset(event, ${asset.id})">
            <div class="form-row">
                <div class="form-group">
                    <label>Asset Tag</label>
                    <input type="text" id="editAssetTag" value="${escapeHTML(asset.assetTag)}" required>
                </div>
                <div class="form-group">
                    <label>Serial Number</label>
                    <input type="text" id="editAssetSerial" value="${escapeHTML(asset.serialNumber)}" required>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Category</label>
                    <select id="editAssetCat">
                        <option value="Laptop" ${asset.category === 'Laptop' ? 'selected' : ''}>Laptop</option>
                        <option value="Monitor" ${asset.category === 'Monitor' ? 'selected' : ''}>Monitor</option>
                        <option value="Peripheral" ${asset.category === 'Peripheral' ? 'selected' : ''}>Peripheral</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Operational Status</label>
                    <select id="editAssetStatus">
                        <option value="Unassigned" ${asset.status === 'Unassigned' ? 'selected' : ''}>Unassigned</option>
                        <option value="Assigned" ${asset.status === 'Assigned' ? 'selected' : ''}>Assigned</option>
                        <option value="In Maintenance" ${asset.status === 'In Maintenance' ? 'selected' : ''}>In Maintenance</option>
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Model</label>
                    <input type="text" id="editAssetModel" value="${escapeHTML(asset.model)}" required>
                </div>
                <div class="form-group">
                    <label>Deployment Setup</label>
                    <select id="editAssetLoc">
                        <option value="Office" ${asset.location === 'Office' ? 'selected' : ''}>Office</option>
                        <option value="Work From Home" ${asset.location === 'Work From Home' ? 'selected' : ''}>Work From Home</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Assigned Employee</label>
                <select id="editAssetEmp">
                    <option value="">-- Unassigned --</option>
                    ${empOptions}
                </select>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Warranty Start</label>
                    <input type="date" id="editAssetWStart" value="${asset.warrantyStart || ''}">
                </div>
                <div class="form-group">
                    <label>Warranty End</label>
                    <input type="date" id="editAssetWEnd" value="${asset.warrantyEnd || ''}">
                </div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px;">
                <button type="button" class="btn btn-danger" onclick="deleteAsset(${asset.id})">Delete</button>
                <div style="display: flex; gap: 8px;">
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save Changes</button>
                </div>
            </div>
        </form>
    `;
    modal.style.display = 'flex';
}
window.openEditAssetModal = openEditAssetModal;

async function submitEditAsset(e, id) {
    e.preventDefault();
    const empId = document.getElementById('editAssetEmp').value || null;
    let status = document.getElementById('editAssetStatus').value;
    if (empId && status === 'Unassigned') status = 'Assigned';
    if (!empId && status === 'Assigned') status = 'Unassigned';

    const payload = {
        assetTag: document.getElementById('editAssetTag').value.trim(),
        serialNumber: document.getElementById('editAssetSerial').value.trim(),
        category: document.getElementById('editAssetCat').value,
        model: document.getElementById('editAssetModel').value.trim(),
        location: document.getElementById('editAssetLoc').value,
        assignedEmployeeId: empId,
        status,
        warrantyStart: document.getElementById('editAssetWStart').value || null,
        warrantyEnd: document.getElementById('editAssetWEnd').value || null
    };

    const res = await fetch(`/api/assets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (res.ok) {
        closeModal();
        await loadAssets();
        await loadOverviewTelemetry();
    }
}
window.submitEditAsset = submitEditAsset;

async function deleteAsset(id) {
    if (!confirm('Permanently delete this asset record?')) return;
    const res = await fetch(`/api/assets/${id}`, { method: 'DELETE' });
    if (res.ok) {
        closeModal();
        await loadAssets();
        await loadOverviewTelemetry();
    }
}
window.deleteAsset = deleteAsset;

async function restoreFromMaintenance(id) {
    const asset = allAssetsCache.find(a => a.id === id);
    if (!asset) return;
    const res = await fetch(`/api/assets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...asset,
            status: asset.assignedEmployeeId ? 'Assigned' : 'Unassigned'
        })
    });
    if (res.ok) {
        await loadAssets();
        await loadOverviewTelemetry();
    }
}
window.restoreFromMaintenance = restoreFromMaintenance;

function exportInventory() {
    if (!currentSiteId) return;
    window.location.href = `/api/export?site_id=${currentSiteId}`;
}
window.exportInventory = exportInventory;

/* =========================================================
   3. BULK IMPORT & STAGING SANDBOX
   ========================================================= */
async function loadStagingData() {
    if (!currentSiteId) return;
    try {
        const res = await fetch(`/api/import/staging?site_id=${currentSiteId}`);
        if (!res.ok) return;
        stagedAssetsCache = await res.json();

        const countEl = document.getElementById('stagingCountText');
        if (countEl) countEl.innerText = `${stagedAssetsCache.length} row(s) staged`;

        const body = document.getElementById('stagingTableBody');
        if (body) {
            body.innerHTML = stagedAssetsCache.length === 0 ? `<tr><td colspan="8" style="text-align:center; color:var(--text-secondary);">No staged rows. Upload an Excel spreadsheet to validate entries.</td></tr>` :
            stagedAssetsCache.map(r => `
                <tr>
                    <td><strong>${escapeHTML(r.assetTag)}</strong></td>
                    <td>${escapeHTML(r.serialNumber)}</td>
                    <td>${escapeHTML(r.category)}</td>
                    <td>${escapeHTML(r.model)}</td>
                    <td>${escapeHTML(r.location || 'Office')}</td>
                    <td>${escapeHTML(r.assignedEmployeeEmail || 'Unassigned')}</td>
                    <td><span class="badge ${r.validationStatus === 'Valid' ? 'open' : 'high'}">${escapeHTML(r.validationStatus)}</span></td>
                    <td style="text-align: right;">
                        <button class="btn btn-danger" style="padding: 3px 8px; font-size: 11px;" onclick="deleteStagedRow(${r.id})">Remove</button>
                    </td>
                </tr>
            `).join('');
        }
    } catch (err) {
        console.error('Staging load error:', err);
    }
}

async function uploadExcelToStaging(e) {
    const file = e.target.files[0];
    if (!file || !currentSiteId) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('site_id', currentSiteId);

    const res = await fetch('/api/import/upload', { method: 'POST', body: formData });
    e.target.value = '';
    if (res.ok) {
        await loadStagingData();
    } else {
        const err = await res.json();
        showNoticeModal('Upload Error', err.error || 'Failed to parse spreadsheet.');
    }
}
window.uploadExcelToStaging = uploadExcelToStaging;

async function deleteStagedRow(id) {
    const res = await fetch(`/api/import/staging/${id}`, { method: 'DELETE' });
    if (res.ok) await loadStagingData();
}
window.deleteStagedRow = deleteStagedRow;

async function flushStagingSandbox() {
    if (!currentSiteId) return;
    const res = await fetch(`/api/import/staging?site_id=${currentSiteId}`, { method: 'DELETE' });
    if (res.ok) await loadStagingData();
}
window.flushStagingSandbox = flushStagingSandbox;

async function pushStagingToProduction() {
    if (!currentSiteId) return;
    const res = await fetch('/api/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: currentSiteId })
    });
    const data = await res.json();
    if (res.ok) {
        showNoticeModal('Import Complete', data.message || 'Staged rows committed to live fleet.');
        await loadStagingData();
        await loadAssets();
        await loadOverviewTelemetry();
    } else {
        showNoticeModal('Commit Notice', data.error || 'No valid rows available to import.');
    }
}
window.pushStagingToProduction = pushStagingToProduction;

/* =========================================================
   4. STAFF DIRECTORY & TEAMS
   ========================================================= */
async function loadEmployees() {
    if (!currentSiteId) return;
    try {
        const res = await fetch(`/api/employees?site_id=${currentSiteId}`);
        if (!res.ok) return;
        allEmployeesCache = await res.json();

        const body = document.getElementById('employeeTableBody');
        if (body) {
            body.innerHTML = allEmployeesCache.length === 0 ? `<tr><td colspan="4" style="text-align:center; color:var(--text-secondary);">No staff members registered at this site.</td></tr>` :
            allEmployeesCache.map(emp => `
                <tr>
                    <td><strong>${escapeHTML(emp.name)}</strong></td>
                    <td>${escapeHTML(emp.email)}</td>
                    <td><span class="badge viewer">${escapeHTML(emp.teamName || 'Unassigned')}</span></td>
                    <td style="text-align: right;">
                        <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="viewEmployeeAssets(${emp.id})">View Assets</button>
                    </td>
                </tr>
            `).join('');
        }
    } catch (err) {
        console.error('Employees load error:', err);
    }
}

async function loadTeams() {
    try {
        const res = await fetch('/api/teams');
        if (!res.ok) return;
        allTeamsCache = await res.json();

        const container = document.getElementById('teamListContainer');
        if (container) {
            container.innerHTML = allTeamsCache.length === 0 ? `<p style="font-size:12px; color:var(--text-secondary);">No department teams created.</p>` :
            allTeamsCache.map(t => `
                <div style="padding: 10px 12px; background: #F8FAFC; border: 1px solid var(--border-color); border-radius: 4px;">
                    <strong style="font-size: 12.5px; display: block;">${escapeHTML(t.teamName)}</strong>
                    <span style="font-size: 11.5px; color: var(--text-secondary);">${escapeHTML(t.description || 'No description')}</span>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error('Teams load error:', err);
    }
}

async function viewEmployeeAssets(empId) {
    const res = await fetch(`/api/employees/${empId}`);
    if (!res.ok) return;
    const { employee, assets } = await res.json();

    modalWrapper.innerHTML = `
        <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 4px;">${escapeHTML(employee.name)}</h3>
        <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 14px;">${escapeHTML(employee.email)} &bull; ${escapeHTML(employee.teamName || 'No Team')}</p>
        <div style="border-top: 1px solid var(--border-color); padding-top: 10px; margin-bottom: 16px;">
            <strong style="font-size: 11.5px; text-transform: uppercase; color: var(--text-secondary); display: block; margin-bottom: 8px;">Assigned Equipment (${assets.length})</strong>
            ${assets.length === 0 ? `<p style="font-size: 12px; color: var(--text-secondary);">No hardware currently assigned.</p>` :
            assets.map(a => `<div style="padding: 6px 8px; background: #F8FAFC; border: 1px solid var(--border-color); border-radius: 4px; margin-bottom: 6px; font-size: 12px;">
                <strong>${escapeHTML(a.assetTag)}</strong> &mdash; ${escapeHTML(a.category)}: ${escapeHTML(a.model)}
            </div>`).join('')}
        </div>
        <div style="display: flex; justify-content: flex-end;">
            <button type="button" class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
    `;
    modal.style.display = 'flex';
}
window.viewEmployeeAssets = viewEmployeeAssets;

function openEmployeeModal() {
    const teamOptions = allTeamsCache.map(t => `<option value="${t.id}">${escapeHTML(t.teamName)}</option>`).join('');
    modalWrapper.innerHTML = `
        <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 14px;">Register Staff Member</h3>
        <form onsubmit="submitNewEmployee(event)">
            <div class="form-group">
                <label>Full Name</label>
                <input type="text" id="empName" required placeholder="e.g. Jane Doe">
            </div>
            <div class="form-group">
                <label>Corporate Email</label>
                <input type="email" id="empEmail" required placeholder="jane.doe@company.com">
            </div>
            <div class="form-group">
                <label>Department Team</label>
                <select id="empTeam">
                    <option value="">-- None --</option>
                    ${teamOptions}
                </select>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Employee</button>
            </div>
        </form>
    `;
    modal.style.display = 'flex';
}
window.openEmployeeModal = openEmployeeModal;

async function submitNewEmployee(e) {
    e.preventDefault();
    const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: document.getElementById('empName').value.trim(),
            email: document.getElementById('empEmail').value.trim(),
            teamId: document.getElementById('empTeam').value || null,
            site_id: currentSiteId
        })
    });
    if (res.ok) {
        closeModal();
        await loadEmployees();
    }
}
window.submitNewEmployee = submitNewEmployee;

function openTeamModal() {
    modalWrapper.innerHTML = `
        <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 14px;">Create Department Team</h3>
        <form onsubmit="submitNewTeam(event)">
            <div class="form-group">
                <label>Team Name</label>
                <input type="text" id="teamName" required placeholder="e.g. Infrastructure & Network">
            </div>
            <div class="form-group">
                <label>Description</label>
                <input type="text" id="teamDesc" placeholder="Department scope">
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Create Team</button>
            </div>
        </form>
    `;
    modal.style.display = 'flex';
}
window.openTeamModal = openTeamModal;

async function submitNewTeam(e) {
    e.preventDefault();
    const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            teamName: document.getElementById('teamName').value.trim(),
            description: document.getElementById('teamDesc').value.trim()
        })
    });
    if (res.ok) {
        closeModal();
        await loadTeams();
    }
}
window.submitNewTeam = submitNewTeam;

/* =========================================================
   5. SITE LOCATIONS & USER GOVERNANCE (ADMIN)
   ========================================================= */
function loadSitesTable() {
    const body = document.getElementById('sitesTableBody');
    if (!body) return;
    const isAdmin = currentUserRole === 'ADMIN';
    body.innerHTML = allSitesCache.map(s => `
        <tr>
            <td><strong>${escapeHTML(s.site_code)}</strong></td>
            <td>${escapeHTML(s.site_name)}</td>
            <td style="text-align: right;">
                ${isAdmin ? `<button class="btn btn-danger" style="padding: 3px 8px; font-size: 11px;" onclick="deleteSite(${s.id})">Delete</button>` : '—'}
            </td>
        </tr>
    `).join('');
}

function openSiteModal() {
    modalWrapper.innerHTML = `
        <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 14px;">Add Site Location</h3>
        <form onsubmit="submitNewSite(event)">
            <div class="form-group">
                <label>Site Code</label>
                <input type="text" id="newSiteCode" required placeholder="e.g. US-PA">
            </div>
            <div class="form-group">
                <label>Location Name</label>
                <input type="text" id="newSiteName" required placeholder="e.g. Pennsylvania Office">
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Create Site</button>
            </div>
        </form>
    `;
    modal.style.display = 'flex';
}
window.openSiteModal = openSiteModal;

async function submitNewSite(e) {
    e.preventDefault();
    const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            site_code: document.getElementById('newSiteCode').value.trim().toUpperCase(),
            site_name: document.getElementById('newSiteName').value.trim()
        })
    });
    if (res.ok) {
        closeModal();
        await loadGlobalSites();
        loadSitesTable();
    } else {
        const err = await res.json();
        alert(err.error || 'Failed to add site.');
    }
}
window.submitNewSite = submitNewSite;

async function deleteSite(id) {
    if (!confirm('Delete this site location?')) return;
    const res = await fetch(`/api/sites/${id}`, { method: 'DELETE' });
    if (res.ok) {
        await loadGlobalSites();
        loadSitesTable();
    }
}
window.deleteSite = deleteSite;

async function loadSystemUsers() {
    if (currentUserRole !== 'ADMIN') return;
    try {
        const res = await fetch('/api/users');
        if (!res.ok) return;
        allSystemUsersCache = await res.json();

        const body = document.getElementById('systemUsersTableBody');
        if (body) {
            body.innerHTML = allSystemUsersCache.map(u => {
                const siteBadges = u.role === 'ADMIN' 
                    ? `<span class="badge admin">All Sites (Global)</span>` 
                    : (u.assignedSites.length > 0 ? u.assignedSites.map(s => `<span class="badge viewer" style="margin-right:4px;">${escapeHTML(s.site_code)}</span>`).join('') : '<span style="color:var(--text-secondary);">None</span>');

                return `
                    <tr>
                        <td><strong>${escapeHTML(u.name)}</strong></td>
                        <td>${escapeHTML(u.email)}</td>
                        <td><span class="badge ${u.role.toLowerCase()}">${escapeHTML(u.role)}</span></td>
                        <td>${siteBadges}</td>
                        <td><span class="badge open">Active</span></td>
                        <td style="text-align: right;">
                            <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="openEditUserModal(${u.id})">Manage</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    } catch (err) {
        console.error('Failed to load system users:', err);
    }
}

function openRegisterUserModal() {
    const siteOptions = allSitesCache.map(s => `<option value="${s.id}">${escapeHTML(s.site_code)} - ${escapeHTML(s.site_name)}</option>`).join('');
    modalWrapper.innerHTML = `
        <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 14px;">Register System User</h3>
        <form onsubmit="submitNewSystemUser(event)">
            <div class="form-group">
                <label>Full Name</label>
                <input type="text" id="sysUserName" required>
            </div>
            <div class="form-group">
                <label>Email Address</label>
                <input type="email" id="sysUserEmail" required>
            </div>
            <div class="form-group">
                <label>Temporary Password</label>
                <input type="password" id="sysUserPass" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Access Role</label>
                    <select id="sysUserRole">
                        <option value="STAFF">IT Staff</option>
                        <option value="VIEWER">Viewer (Read-Only)</option>
                        <option value="ADMIN">Administrator</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Initial Site Scope</label>
                    <select id="sysUserSite">
                        <option value="">-- Global / None --</option>
                        ${siteOptions}
                    </select>
                </div>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Create Account</button>
            </div>
        </form>
    `;
    modal.style.display = 'flex';
}
window.openRegisterUserModal = openRegisterUserModal;

async function submitNewSystemUser(e) {
    e.preventDefault();
    const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: document.getElementById('sysUserName').value.trim(),
            email: document.getElementById('sysUserEmail').value.trim(),
            password: document.getElementById('sysUserPass').value,
            role: document.getElementById('sysUserRole').value,
            site_id: document.getElementById('sysUserSite').value || null
        })
    });
    if (res.ok) {
        closeModal();
        await loadSystemUsers();
    } else {
        const err = await res.json();
        alert(err.error || 'Failed to register user.');
    }
}
window.submitNewSystemUser = submitNewSystemUser;

function openEditUserModal(userId) {
    const user = allSystemUsersCache.find(u => u.id === userId);
    if (!user) return;

    const assignedIds = new Set(user.assignedSites.map(s => s.id));
    const siteCheckboxes = allSitesCache.map(s => `
        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 4px; text-transform: none;">
            <input type="checkbox" ${assignedIds.has(s.id) ? 'checked' : ''} onchange="toggleUserSiteAssignment(${user.id}, ${s.id}, this.checked)">
            ${escapeHTML(s.site_code)} - ${escapeHTML(s.site_name)}
        </label>
    `).join('');

    modalWrapper.innerHTML = `
        <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 14px;">Manage User: ${escapeHTML(user.name)}</h3>
        <form onsubmit="submitEditSystemUser(event, ${user.id})">
            <div class="form-group">
                <label>Full Name</label>
                <input type="text" id="editSysName" value="${escapeHTML(user.name)}" required>
            </div>
            <div class="form-group">
                <label>Email Address</label>
                <input type="email" id="editSysEmail" value="${escapeHTML(user.email)}" required>
            </div>
            <div class="form-group">
                <label>Access Role</label>
                <select id="editSysRole">
                    <option value="ADMIN" ${user.role === 'ADMIN' ? 'selected' : ''}>Administrator</option>
                    <option value="STAFF" ${user.role === 'STAFF' ? 'selected' : ''}>IT Staff</option>
                    <option value="VIEWER" ${user.role === 'VIEWER' ? 'selected' : ''}>Viewer</option>
                </select>
            </div>
            ${user.role !== 'ADMIN' ? `
            <div class="form-group">
                <label>Site Access Permissions</label>
                <div style="background: #F8FAFC; border: 1px solid var(--border-color); padding: 8px; border-radius: 4px; max-height: 110px; overflow-y: auto;">
                    ${siteCheckboxes}
                </div>
            </div>` : ''}
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px;">
                ${user.id !== currentUserId ? `<button type="button" class="btn btn-danger" onclick="deleteSystemUser(${user.id})">Delete User</button>` : '<span></span>'}
                <div style="display: flex; gap: 8px;">
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>
                </div>
            </div>
        </form>
    `;
    modal.style.display = 'flex';
}
window.openEditUserModal = openEditUserModal;

async function toggleUserSiteAssignment(userId, siteId, isAssigned) {
    const method = isAssigned ? 'POST' : 'DELETE';
    await fetch(`/api/sites/${siteId}/assign`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId })
    });
    await loadSystemUsers();
}
window.toggleUserSiteAssignment = toggleUserSiteAssignment;

async function submitEditSystemUser(e, userId) {
    e.preventDefault();
    const res = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: document.getElementById('editSysName').value.trim(),
            email: document.getElementById('editSysEmail').value.trim(),
            role: document.getElementById('editSysRole').value
        })
    });
    if (res.ok) {
        closeModal();
        await loadSystemUsers();
    }
}
window.submitEditSystemUser = submitEditSystemUser;

async function deleteSystemUser(userId) {
    if (!confirm('Remove this system user account?')) return;
    const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
    if (res.ok) {
        closeModal();
        await loadSystemUsers();
    }
}
window.deleteSystemUser = deleteSystemUser;