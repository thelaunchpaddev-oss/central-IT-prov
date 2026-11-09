let currentUserRole = 'VIEWER';
let currentUserId = null;
let currentSiteId = null;
let allSystemUsersCache = [];
let allAssetsCache = [];
let stagedAssetsCache = [];
let allSitesCache = [];

const modal = document.getElementById('appModal');
const modalWrapper = document.getElementById('modalContentWrapper');

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const sessionRes = await fetch('/api/session');
        if (sessionRes.ok) {
            const user = await sessionRes.json();
            currentUserRole = user.role || 'VIEWER';
            currentUserId = user.id;

            const initials = escapeHTML(user.name).split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            
            const avatarEl = document.querySelector('.user-avatar');
            const nameEl = document.querySelector('.user-name');
            const roleEl = document.querySelector('.user-role');

            if (avatarEl) avatarEl.innerText = initials;
            if (nameEl) nameEl.innerText = escapeHTML(user.name);
            if (roleEl) roleEl.innerText = user.role === 'ADMIN' ? 'Administrator' : user.role === 'STAFF' ? 'IT Staff' : 'Viewer';

            if (currentUserRole === 'ADMIN') {
                document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex');
                loadSystemUsers();
            } else {
                document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
            }

            if (currentUserRole !== 'VIEWER') {
                document.querySelectorAll('.role-protected').forEach(el => el.style.display = 'flex');
            } else {
                document.querySelectorAll('.role-protected').forEach(el => el.style.display = 'none');
            }
        }
    } catch (err) {
        console.error('Session metadata loading error:', err);
    }

    await loadGlobalSites();
    
    loadOverviewTelemetry();
    loadAssets();
    loadEmployees();
    loadTeams();
    loadMaintenanceAssets();

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

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.row-action-menu')) {
            document.querySelectorAll('.row-dropdown.show').forEach(d => d.classList.remove('show'));
        }
    });

    const signOutBtn = document.getElementById('btnSignOut');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', logoutUser);
    }
});

/* =========================================================
   SITE MANAGEMENT & CONTEXT SWITCHING
   ========================================================= */

async function loadGlobalSites() {
    try {
        const res = await fetch('/api/sites');
        if (!res.ok) return;
        allSitesCache = await res.json();
        
        const selectEl = document.getElementById('globalSiteSelector');
        if (!selectEl) return;
        
        if (!allSitesCache || allSitesCache.length === 0) {
            selectEl.innerHTML = `<option value="">No Sites Available</option>`;
            currentSiteId = null;
            renderSitesTable();
            return;
        }

        selectEl.innerHTML = allSitesCache.map(s => `<option value="${s.id}">${escapeHTML(s.site_code)} - ${escapeHTML(s.site_name)}</option>`).join('');
        
        const cachedSite = localStorage.getItem('preferredSiteId');
        if (cachedSite && allSitesCache.some(s => s.id == cachedSite)) {
            currentSiteId = cachedSite;
        } else {
            currentSiteId = allSitesCache[0].id;
        }
        selectEl.value = currentSiteId;
        renderSitesTable();
    } catch (err) {
        console.error('Failed to load global sites:', err);
    }
}

function switchGlobalSite(siteId) {
    if (!siteId) return;
    currentSiteId = siteId;
    localStorage.setItem('preferredSiteId', siteId);
    
    loadOverviewTelemetry();
    loadAssets();
    loadEmployees();
    loadMaintenanceAssets();
    loadStagingSandbox();
}
window.switchGlobalSite = switchGlobalSite;

function renderSitesTable() {
    const tbody = document.getElementById('sitesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!allSitesCache || allSitesCache.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary);">No sites created yet. Use the top button to add a location.</td></tr>`;
        return;
    }

    allSitesCache.forEach(site => {
        const tr = document.createElement('tr');
        
        let actionBtns = `
            <button class="btn btn-secondary role-protected" style="padding: 4px 10px; font-size: 11px; width: auto;" onclick="openAssignSiteUserModal(${site.id})">Assign User</button>
        `;
        
        if (currentUserRole === 'ADMIN') {
            actionBtns += `<button class="btn btn-danger" style="padding: 4px 10px; font-size: 11px; width: auto; margin-left: 6px;" onclick="executeSiteDelete(${site.id})">Delete</button>`;
        } else if (currentUserRole === 'VIEWER') {
            actionBtns = '<em style="font-size: 11px; color: var(--text-secondary);">Read Only</em>';
        }

        tr.innerHTML = `
            <td><strong>${escapeHTML(site.site_code)}</strong></td>
            <td>${escapeHTML(site.site_name)}</td>
            <td style="text-align: right;">${actionBtns}</td>
        `;
        tbody.appendChild(tr);
    });
}

function openSiteModal() {
    if (!modalWrapper || !modal) return;
    modalWrapper.innerHTML = `
        <h3>Add New Site Location</h3>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 24px;">Create a new physical or virtual operating region.</p>
        <form onsubmit="submitNewSite(event)">
            <div class="form-group"><label>Site Code (e.g., USA, PH, UK)</label><input type="text" id="newSiteCode" required placeholder="USA"></div>
            <div class="form-group"><label>Full Site Name</label><input type="text" id="newSiteName" required placeholder="United States Headquarters"></div>
            <div style="display: flex; gap: 12px; margin-top: 28px; justify-content: flex-end;">
                <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
                <button type="submit" class="btn btn-primary" style="width: auto;">Create Site</button>
            </div>
        </form>
    `;
    modal.style.display = 'flex';
}
window.openSiteModal = openSiteModal;

async function submitNewSite(e) {
    e.preventDefault();
    const data = {
        site_code: document.getElementById('newSiteCode').value,
        site_name: document.getElementById('newSiteName').value
    };

    const res = await fetch('/api/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.ok) { closeModal(); await loadGlobalSites(); switchGlobalSite(allSitesCache[allSitesCache.length - 1]?.id); }
    else { const errData = await res.json(); showNoticeModal('Error', errData.error || 'Failed to create site.', 'error'); }
}
window.submitNewSite = submitNewSite;

function executeSiteDelete(siteId) {
    if (!modalWrapper || !modal) return;
    const targetSite = allSitesCache.find(s => s.id === siteId);
    
    modalWrapper.innerHTML = `
        <h3 style="color: var(--danger);">Delete Site Context</h3>
        <p>Are you sure you want to permanently delete <strong>${escapeHTML(targetSite ? targetSite.site_name : '')}</strong>? All mapped assets will be removed.</p>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
            <button onclick="confirmSiteDelete(${siteId})" class="btn btn-danger" style="width: auto;">Delete Permanently</button>
        </div>
    `;
    modal.style.display = 'flex';
}
window.executeSiteDelete = executeSiteDelete;

async function confirmSiteDelete(siteId) {
    const res = await fetch(`/api/sites/${siteId}`, { method: 'DELETE' });
    if (res.ok) { closeModal(); loadGlobalSites(); }
}
window.confirmSiteDelete = confirmSiteDelete;

async function openAssignSiteUserModal(siteId) {
    if (!modalWrapper || !modal) return;
    
    let users = [];
    try {
        const usersRes = await fetch('/api/users');
        if (usersRes.ok) users = await usersRes.json();
    } catch (e) {
        console.error('Failed to fetch system users for assignment:', e);
    }

    const userOptions = Array.isArray(users) && users.length > 0 
        ? users.map(u => `<option value="${u.id}">${escapeHTML(u.name)} (${escapeHTML(u.email)})</option>`).join('')
        : '<option value="">No Users Available</option>';

    modalWrapper.innerHTML = `
        <h3>Assign User to Site</h3>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 24px;">Grant a system user access to manage assets in this location.</p>
        <form onsubmit="submitSiteAssignment(event, ${siteId})">
            <div class="form-group">
                <label>Select System User</label>
                <select id="siteAssignUserId" required>
                    <option value="">-- Choose User --</option>
                    ${userOptions}
                </select>
            </div>
            <div style="display: flex; gap: 12px; margin-top: 28px; justify-content: flex-end;">
                <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
                <button type="submit" id="btnSubmitAssignSite" class="btn btn-primary" style="width: auto;">Assign to Site</button>
            </div>
        </form>
    `;
    modal.style.display = 'flex';
}
window.openAssignSiteUserModal = openAssignSiteUserModal;

async function submitSiteAssignment(e, siteId) {
    e.preventDefault();
    const submitBtn = document.getElementById('btnSubmitAssignSite');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="spinner-sm"></span> Assigning...`;
    }

    const userId = document.getElementById('siteAssignUserId')?.value;
    if (!userId) {
        showNoticeModal('Validation Error', 'Please select a system user from the dropdown.', 'error');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = 'Assign to Site'; }
        return;
    }

    try {
        const res = await fetch(`/api/sites/${siteId}/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal();
            showNoticeModal('Success', 'User granted access to site context.');
            loadGlobalSites();
            loadSystemUsers();
        } else {
            showNoticeModal('Assignment Error', data.error || 'Failed to assign user to site.', 'error');
        }
    } catch (err) {
        showNoticeModal('System Error', 'Server error while assigning user to site.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Assign to Site';
        }
    }
}
window.submitSiteAssignment = submitSiteAssignment;

function removeUserSiteAccess(siteId, userId, siteCode, userName) {
    if (!modalWrapper || !modal) return;

    modalWrapper.innerHTML = `
        <h3 style="color: var(--danger);">Revoke Site Location Access</h3>
        <p>Are you sure you want to remove site <strong>${escapeHTML(siteCode)}</strong> access for user <strong>${escapeHTML(userName)}</strong>?</p>
        <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
            <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
            <button type="button" id="btnConfirmRevokeSite" onclick="confirmRemoveUserSiteAccess(${siteId}, ${userId})" class="btn btn-danger" style="width: auto;">Revoke Access</button>
        </div>
    `;
    modal.style.display = 'flex';
}
window.removeUserSiteAccess = removeUserSiteAccess;

async function confirmRemoveUserSiteAccess(siteId, userId) {
    const confirmBtn = document.getElementById('btnConfirmRevokeSite');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = `<span class="spinner-sm"></span> Revoking...`;
    }

    try {
        const res = await fetch(`/api/sites/${siteId}/assign`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId })
        });
        const data = await res.json();
        if (res.ok) {
            closeModal();
            loadGlobalSites();
            loadSystemUsers();
        } else {
            closeModal();
            showNoticeModal('Error', data.error || 'Failed to remove site access.', 'error');
        }
    } catch (err) {
        closeModal();
        showNoticeModal('System Error', 'Server connection error while removing site access.', 'error');
    }
}
window.confirmRemoveUserSiteAccess = confirmRemoveUserSiteAccess;

/* =========================================================
   STANDARD DASHBOARD FUNCTIONS & AUTH
   ========================================================= */

async function logoutUser(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    try {
        const res = await fetch('/api/logout', { 
            method: 'POST', headers: { 'Content-Type': 'application/json' }
        });
        if (res.ok) window.location.href = '/login.html';
    } catch (err) { console.error('Logout error:', err); }
}
window.logoutUser = logoutUser;

function openCurrentProfile(e) {
    if (e) e.stopPropagation();
    if (!modalWrapper || !modal) return;

    const currentName = document.querySelector('.user-name')?.innerText || 'User';
    const currentRoleText = document.querySelector('.user-role')?.innerText || '--';

    modalWrapper.innerHTML = `
        <h3>User Profile</h3>
        <p>Currently logged in session details.</p>
        <div style="display: flex; flex-direction: column; gap: 0; font-size: 13px; margin-bottom: 32px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); overflow: hidden;">
            <div style="display: flex; justify-content: space-between; padding: 12px 16px; background: var(--bg-main); border-bottom: 1px solid var(--border-color);">
                <span style="color: var(--text-secondary);">Name:</span>
                <strong>${escapeHTML(currentName)}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 12px 16px; background: #ffffff; border-bottom: 1px solid var(--border-color);">
                <span style="color: var(--text-secondary);">Role Access:</span>
                <strong>${escapeHTML(currentRoleText)}</strong>
            </div>
        </div>
        <div style="display: flex; justify-content: flex-end;">
            <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Close</button>
        </div>
    `;
    modal.style.display = 'flex';
}
window.openCurrentProfile = openCurrentProfile;

function switchTab(tab) {
    if (tab === 'import' && currentUserRole !== 'ADMIN') {
        showNoticeModal('Access Denied', 'Bulk Asset Import requires Administrator access permissions.', 'error');
        return;
    }

    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');

    const titleMap = {
        'overview': 'Command Overview',
        'assets': 'Asset Management & Inventory',
        'import': 'Bulk Asset Import & Staging',
        'maintenance': 'Maintenance Queue & Pipeline',
        'directory': 'Staff Directory & Teams',
        'sites': 'Site & Location Scoping',
        'governance': 'User Governance & Access Control'
    };

    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.innerText = titleMap[tab] || 'Dashboard';

    const tabEl = document.getElementById(`tab-${tab}`);
    if (tabEl) tabEl.style.display = 'block';

    if (tab === 'overview') loadOverviewTelemetry();
    if (tab === 'assets') loadAssets();
    if (tab === 'import') loadStagingSandbox();
    if (tab === 'maintenance') loadMaintenanceAssets();
    if (tab === 'directory') { loadEmployees(); loadTeams(); }
    if (tab === 'sites') loadGlobalSites();
    if (tab === 'governance') loadSystemUsers();

    if (window.event && window.event.currentTarget) {
        window.event.currentTarget.classList.add('active');
    }
}
window.switchTab = switchTab;

function switchSubTab(subTab) {
    document.querySelectorAll('.sub-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.sub-tab-content').forEach(content => content.style.display = 'none');

    const targetSubTab = document.getElementById(`subtab-${subTab}`);
    if (targetSubTab) targetSubTab.style.display = 'block';
    
    if (window.event && window.event.target) window.event.target.classList.add('active');
    if (subTab === 'laptops' || subTab === 'monitors' || subTab === 'peripherals') loadAssets();
}
window.switchSubTab = switchSubTab;

async function loadOverviewTelemetry() {
    if (!currentSiteId) return;
    try {
        const [assetsRes, employeesRes] = await Promise.all([
            fetch(`/api/assets?site_id=${currentSiteId}`),
            fetch(`/api/employees?site_id=${currentSiteId}`)
        ]);

        if (assetsRes.status === 401 || employeesRes.status === 401) {
            window.location.href = '/login.html';
            return;
        }

        const assets = await assetsRes.json();
        const statTotal = document.getElementById('statTotalAssets');
        const statAssigned = document.getElementById('statAssignedAssets');
        const statWfh = document.getElementById('statWfhAssets');
        const statMaint = document.getElementById('statMaintAssets');

        if (statTotal) statTotal.innerText = assets.length;
        if (statAssigned) statAssigned.innerText = assets.filter(a => a.status === 'Assigned').length;
        if (statWfh) statWfh.innerText = assets.filter(a => a.category === 'Monitor').length;
        if (statMaint) statMaint.innerText = assets.filter(a => a.status === 'In Maintenance').length;

        const total = assets.length || 1;
        const laptops = Math.round((assets.filter(a => a.category === 'Laptop').length / total) * 100);
        const monitors = Math.round((assets.filter(a => a.category === 'Monitor').length / total) * 100);
        const peripherals = Math.round((assets.filter(a => a.category === 'Peripheral' || a.category === 'Other').length / total) * 100);

        const distContainer = document.querySelector('.distribution-bars');
        if (distContainer) {
            distContainer.innerHTML = `
                <div class="dist-row"><span>Laptops & Mobile Units</span><strong>${laptops}%</strong></div>
                <div class="progress-bar"><div></div></div>
                <div class="dist-row"><span>Monitors & Displays</span><strong>${monitors}%</strong></div>
                <div class="progress-bar"><div></div></div>
                <div class="dist-row"><span>Peripherals & Other</span><strong>${peripherals}%</strong></div>
                <div class="progress-bar"><div></div></div>
            `;
            const bars = distContainer.querySelectorAll('.progress-bar div');
            if (bars[0]) bars[0].style.width = `${laptops}%`;
            if (bars[1]) bars[1].style.width = `${monitors}%`;
            if (bars[2]) bars[2].style.width = `${peripherals}%`;
        }

        const feedContainer = document.getElementById('activityFeedList');
        if (feedContainer) {
            const allMonitors = assets.filter(a => a.category === 'Monitor').length;
            const maintCount = assets.filter(a => a.status === 'In Maintenance').length;

            let feedHtml = `
                <li>
                    <div class="feed-icon" style="background: #EFF6FF; color: #2563EB;">
                        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                    </div>
                    <div>
                        <strong style="font-size: 14px; color: var(--text-primary);">Total Monitors (${allMonitors})</strong>
                        <p style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">${allMonitors} monitor(s) currently registered in the hardware fleet.</p>
                    </div>
                </li>
            `;

            if (maintCount > 0) {
                feedHtml += `
                    <li>
                        <div class="feed-icon" style="background: var(--danger-bg); color: var(--danger);">
                            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        </div>
                        <div>
                            <strong style="font-size: 14px; color: var(--text-primary);">Maintenance Backlog (${maintCount})</strong>
                            <p style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">${maintCount} hardware unit(s) currently flagged for repair in Asset Management.</p>
                        </div>
                    </li>
                `;
            } else {
                feedHtml += `
                    <li>
                        <div class="feed-icon" style="background: var(--success-bg); color: var(--success);">
                            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
                        </div>
                        <div>
                            <strong style="font-size: 14px; color: var(--text-primary);">No Repair Backlog</strong>
                            <p style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">All hardware fleet inventory is fully operational and healthy.</p>
                        </div>
                    </li>
                `;
            }
            feedContainer.innerHTML = feedHtml;
        }

    } catch (err) {
        console.error('Failed to load telemetry:', err);
    }

    // Trigger V1.1 Analytics Load
    await loadDashboardAnalytics();
}

async function loadDashboardAnalytics() {
    if (!currentSiteId) return;

    // 1. Hardware Model Breakdown
    try {
        const modelsRes = await fetch(`/api/analytics/models?site_id=${currentSiteId}`);
        if (modelsRes.ok) {
            const models = await modelsRes.json();
            renderModelBreakdown(models);
        }
    } catch (e) {
        console.error('Failed to load model analytics:', e);
    }

    // 2. Laptop Warranty Telemetry
    try {
        const warrantyRes = await fetch(`/api/analytics/warranty-expirations?site_id=${currentSiteId}&days=60`);
        if (warrantyRes.ok) {
            const warrantyData = await warrantyRes.json();
            renderWarrantyHealth(warrantyData);
        }
    } catch (e) {
        console.error('Failed to load warranty analytics:', e);
    }
}

function renderModelBreakdown(models) {
    const container = document.getElementById('modelBreakdownContainer');
    if (!container) return;

    if (!models || models.length === 0) {
        container.innerHTML = `<p style="font-size: 13px; color: var(--text-secondary);">No hardware models registered for this site.</p>`;
        return;
    }

    container.innerHTML = models.map(m => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
            <div>
                <strong style="font-size: 13px; color: var(--text-primary); display: block;">${escapeHTML(m.model)}</strong>
                <span style="font-size: 11px; color: var(--text-secondary);">${escapeHTML(m.category)}</span>
            </div>
            <span class="badge staff" style="font-size: 11px; padding: 2px 8px;">${m.count} unit(s)</span>
        </div>
    `).join('');
}

function renderWarrantyHealth(data) {
    const activeBadge = document.getElementById('statWarrantyActive');
    const expiringBadge = document.getElementById('statWarrantyExpiring');
    const expiredBadge = document.getElementById('statWarrantyExpired');
    const listContainer = document.getElementById('warrantyAlertList');

    if (activeBadge) activeBadge.innerText = `Active: ${data.activeCount}`;
    if (expiringBadge) expiringBadge.innerText = `Expiring Soon: ${data.expiringSoonCount}`;
    if (expiredBadge) expiredBadge.innerText = `Expired: ${data.expiredCount}`;

    if (!listContainer) return;

    if (!data.items || data.items.length === 0) {
        listContainer.innerHTML = `<p style="font-size: 13px; color: var(--text-secondary);">No laptop warranties recorded for this site.</p>`;
        return;
    }

    listContainer.innerHTML = data.items.map(l => {
        let badgeClass = 'viewer';
        let statusLabel = l.warrantyStatus;

        if (l.warrantyStatus === 'Active') badgeClass = 'open';
        else if (l.warrantyStatus === 'Expiring Soon') badgeClass = 'warning';
        else if (l.warrantyStatus === 'Expired') badgeClass = 'high';

        const daysText = l.daysRemaining !== null 
            ? (l.daysRemaining < 0 ? `${Math.abs(l.daysRemaining)} days ago` : `In ${l.daysRemaining} days`) 
            : 'No End Date';

        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
                <div>
                    <strong style="font-size: 13px; color: var(--text-primary); display: block;">${escapeHTML(l.assetTag)} (${escapeHTML(l.model || 'Laptop')})</strong>
                    <span style="font-size: 11px; color: var(--text-secondary);">Assigned: ${escapeHTML(l.assignedEmployeeName)}</span>
                </div>
                <div style="text-align: right;">
                    <span class="badge ${badgeClass}" style="font-size: 11px; padding: 2px 6px;">${statusLabel}</span>
                    <span style="display: block; font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${daysText}</span>
                </div>
            </div>
        `;
    }).join('');
}

async function loadAssets() {
    if (!currentSiteId) return;
    try {
        const res = await fetch(`/api/assets?site_id=${currentSiteId}`);
        if (res.status === 401) { window.location.href = '/login.html'; return; }
        allAssetsCache = await res.json();
        renderCategorizedTables(allAssetsCache);
        loadOverviewTelemetry();
    } catch (err) { console.error('Failed to load assets:', err); }
}

function renderCategorizedTables(assets) {
    const activeAssets = assets.filter(a => a.status !== 'In Maintenance');

    const laptopBody = document.getElementById('laptopTableBody');
    const laptops = activeAssets.filter(a => a.category === 'Laptop');
    if (laptopBody) {
        laptopBody.innerHTML = '';
        if (laptops.length === 0) {
            laptopBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">No laptop assets registered.</td></tr>`;
        } else {
            laptops.forEach(asset => {
                const tr = document.createElement('tr');
                const wStatus = calculateWarrantyStatus(asset.warrantyEnd);
                const wPeriod = asset.warrantyStart && asset.warrantyEnd ? `${escapeHTML(asset.warrantyStart)} to ${escapeHTML(asset.warrantyEnd)}` : 'N/A';
                let actionHtml = currentUserRole === 'VIEWER' ? '<em style="font-size: 11px; color: var(--text-secondary);">Read Only</em>' : renderRowActionDropdown(asset.id);

                tr.innerHTML = `
                    <td><strong>${escapeHTML(asset.assetTag)}</strong></td>
                    <td>${escapeHTML(asset.model)}</td>
                    <td>${escapeHTML(asset.serialNumber)}</td>
                    <td><span class="badge ${asset.status === 'Assigned' ? 'open' : 'viewer'}">${escapeHTML(asset.status)}</span></td>
                    <td>${asset.assignedEmployeeName ? escapeHTML(asset.assignedEmployeeName) : '<em style="color: var(--text-secondary);">Unassigned</em>'}</td>
                    <td>${wPeriod}</td>
                    <td>${wStatus}</td>
                    <td style="text-align: right;">${actionHtml}</td>
                `;
                laptopBody.appendChild(tr);
            });
        }
    }

    const monitorBody = document.getElementById('monitorTableBody');
    const monitors = activeAssets.filter(a => a.category === 'Monitor');
    if (monitorBody) {
        monitorBody.innerHTML = '';
        if (monitors.length === 0) {
            monitorBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary);">No monitor assets registered.</td></tr>`;
        } else {
            monitors.forEach(asset => {
                const tr = document.createElement('tr');
                const locBadge = asset.location === 'Work From Home' ? '<span class="badge staff">WFH</span>' : '<span class="badge viewer">Office</span>';
                let actionHtml = currentUserRole === 'VIEWER' ? '<em style="font-size: 11px; color: var(--text-secondary);">Read Only</em>' : renderRowActionDropdown(asset.id);

                tr.innerHTML = `
                    <td><strong>${escapeHTML(asset.assetTag)}</strong></td>
                    <td>${escapeHTML(asset.model)}</td>
                    <td>${escapeHTML(asset.serialNumber)}</td>
                    <td>${locBadge}</td>
                    <td><span class="badge ${asset.status === 'Assigned' ? 'open' : 'viewer'}">${escapeHTML(asset.status)}</span></td>
                    <td>${asset.assignedEmployeeName ? escapeHTML(asset.assignedEmployeeName) : '<em style="color: var(--text-secondary);">Unassigned</em>'}</td>
                    <td style="text-align: right;">${actionHtml}</td>
                `;
                monitorBody.appendChild(tr);
            });
        }
    }

    const peripheralBody = document.getElementById('peripheralTableBody');
    const peripherals = activeAssets.filter(a => a.category === 'Peripheral' || a.category === 'Other');
    if (peripheralBody) {
        peripheralBody.innerHTML = '';
        if (peripherals.length === 0) {
            peripheralBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">No peripherals registered.</td></tr>`;
        } else {
            peripherals.forEach(asset => {
                const tr = document.createElement('tr');
                let actionHtml = currentUserRole === 'VIEWER' ? '<em style="font-size: 11px; color: var(--text-secondary);">Read Only</em>' : renderRowActionDropdown(asset.id);

                tr.innerHTML = `
                    <td><strong>${escapeHTML(asset.assetTag)}</strong></td>
                    <td>${escapeHTML(asset.category)} <br><span style="color: var(--text-secondary); font-size: 11px;">${escapeHTML(asset.model)}</span></td>
                    <td>${escapeHTML(asset.serialNumber)}</td>
                    <td><span class="badge ${asset.status === 'Assigned' ? 'open' : 'viewer'}">${escapeHTML(asset.status)}</span></td>
                    <td>${asset.assignedEmployeeName ? escapeHTML(asset.assignedEmployeeName) : '<em style="color: var(--text-secondary);">Unassigned</em>'}</td>
                    <td style="text-align: right;">${actionHtml}</td>
                `;
                peripheralBody.appendChild(tr);
            });
        }
    }
}

/* =========================================================
   DYNAMIC VIEWPORT-FLOATING ROW DROPDOWNS (UNCLIPPED)
   ========================================================= */

function renderRowActionDropdown(assetId) {
    const targetAsset = allAssetsCache.find(a => a.id === assetId);
    const isMonitor = targetAsset && targetAsset.category === 'Monitor';
    const monitorAction = isMonitor ? `<button class="dropdown-item" onclick="openLocationModal(${assetId})">Change Location</button>` : '';

    return `
        <div class="row-action-menu" style="position: relative; display: inline-block;">
            <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px; width: auto;" onclick="toggleRowDropdown(event, ${assetId})">
                Actions &#9662;
            </button>
            <div id="rowDropdown-${assetId}" class="row-dropdown">
                <button class="dropdown-item" onclick="openAssignModal(${assetId})">Assign User</button>
                ${monitorAction}
                <button class="dropdown-item" onclick="openStatusModal(${assetId})">Change Status</button>
                <div style="height: 1px; background: var(--border-color); margin: 4px 0;"></div>
                <button class="dropdown-item" style="color: var(--danger);" onclick="executeSingleDelete(${assetId})">Delete</button>
            </div>
        </div>
    `;
}

function toggleRowDropdown(e, dropdownKey) {
    e.stopPropagation();
    const btn = e.currentTarget;
    const target = document.getElementById(`rowDropdown-${dropdownKey}`);
    
    document.querySelectorAll('.row-dropdown.show').forEach(d => { 
        if (d !== target) d.classList.remove('show'); 
    });

    if (!target) return;

    const isShowing = target.classList.contains('show');
    if (isShowing) {
        target.classList.remove('show');
        return;
    }

    target.classList.add('show');

    const rect = btn.getBoundingClientRect();
    const dropdownHeight = target.offsetHeight || 160;
    const dropdownWidth = target.offsetWidth || 170;
    const windowHeight = window.innerHeight;

    const spaceBelow = windowHeight - rect.bottom;
    const openUpward = spaceBelow < dropdownHeight + 10 && rect.top > dropdownHeight + 10;

    target.style.position = 'fixed';
    target.style.zIndex = '99999';
    target.style.left = `${rect.right - dropdownWidth}px`;

    if (openUpward) {
        target.style.top = `${rect.top - dropdownHeight - 4}px`;
    } else {
        target.style.top = `${rect.bottom + 4}px`;
    }
}
window.toggleRowDropdown = toggleRowDropdown;

window.addEventListener('scroll', () => {
    document.querySelectorAll('.row-dropdown.show').forEach(d => d.classList.remove('show'));
}, true);

/* =========================================================
   STAGING & BULK SPREADSHEET IMPORT
   ========================================================= */

async function uploadExcelToStaging(event) {
    const file = event.target.files[0];
    if (!file || !currentSiteId) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('site_id', currentSiteId);

    try {
        const res = await fetch('/api/import/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (res.ok) {
            showNoticeModal('Batch Staging Successful', data.message || 'Spreadsheet rows parsed successfully into staging.');
            loadStagingSandbox();
        } else {
            showNoticeModal('Upload Error', data.error || 'Failed to process spreadsheet file.', 'error');
        }
    } catch (err) {
        showNoticeModal('System Error', 'Server connection error during spreadsheet upload.', 'error');
    } finally {
        event.target.value = '';
    }
}
window.uploadExcelToStaging = uploadExcelToStaging;

async function loadStagingSandbox() {
    if (!currentSiteId) return;
    try {
        const res = await fetch(`/api/import/staging?site_id=${currentSiteId}`);
        if (res.status === 401 || res.status === 403) return;
        stagedAssetsCache = await res.json();

        const countText = document.getElementById('stagingCountText');
        if (countText) countText.innerText = `${stagedAssetsCache.length} row(s) staged`;

        const tbody = document.getElementById('stagingTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (stagedAssetsCache.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">No rows currently staged. Download a template above to begin.</td></tr>`;
            return;
        }

        stagedAssetsCache.forEach(row => {
            const tr = document.createElement('tr');
            let statusBadge = `<span class="badge open">Valid</span>`;
            if (row.validationStatus === 'Error') statusBadge = `<span class="badge high">Error: ${escapeHTML(row.validationError)}</span>`;
            else if (row.validationStatus === 'Duplicate') statusBadge = `<span class="badge warning">Duplicate: ${escapeHTML(row.validationError)}</span>`;

            tr.innerHTML = `
                <td><strong>${escapeHTML(row.assetTag)}</strong></td>
                <td>${escapeHTML(row.serialNumber)}</td>
                <td>${escapeHTML(row.category)}</td>
                <td>${escapeHTML(row.model)}</td>
                <td>${row.category === 'Monitor' ? escapeHTML(row.location) : 'N/A'}</td>
                <td>${row.assignedEmployeeEmail ? escapeHTML(row.assignedEmployeeEmail) : '<em style="color:var(--text-secondary);">Unassigned</em>'}</td>
                <td>${statusBadge}</td>
                <td style="text-align: right;">
                    <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 11px; width: auto;" onclick="openEditStagedModal(${row.id})">Edit Row</button>
                    <button class="btn btn-danger" style="padding: 4px 10px; font-size: 11px; width: auto; margin-left: 4px;" onclick="deleteStagedRow(${row.id})">Delete</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Failed to load staging workspace:', err);
    }
}
window.loadStagingSandbox = loadStagingSandbox;

function openEditStagedModal(stagedId) {
    if (!modalWrapper || !modal) return;
    const row = stagedAssetsCache.find(r => r.id === stagedId);
    if (!row) return;

    modalWrapper.innerHTML = `
        <h3>Edit Staged Row</h3>
        <form onsubmit="submitEditStaged(event, ${stagedId})">
            <div class="form-group"><label>Asset Tag ID</label><input type="text" id="stgTag" value="${escapeHTML(row.assetTag)}" required></div>
            <div class="form-group"><label>Serial Number</label><input type="text" id="stgSerial" value="${escapeHTML(row.serialNumber)}" required></div>
            <div class="form-row">
                <div class="form-group"><label>Category</label>
                    <select id="stgCategory">
                        <option value="Laptop" ${row.category === 'Laptop' ? 'selected' : ''}>Laptop</option>
                        <option value="Monitor" ${row.category === 'Monitor' ? 'selected' : ''}>Monitor</option>
                        <option value="Peripheral" ${row.category === 'Peripheral' ? 'selected' : ''}>Peripheral</option>
                    </select>
                </div>
                <div class="form-group"><label>Setup Location</label>
                    <select id="stgLocation">
                        <option value="Office" ${row.location === 'Office' ? 'selected' : ''}>Office</option>
                        <option value="Work From Home" ${row.location === 'Work From Home' ? 'selected' : ''}>Work From Home</option>
                    </select>
                </div>
            </div>
            <div class="form-group"><label>Model</label><input type="text" id="stgModel" value="${escapeHTML(row.model)}" required></div>
            <div class="form-group"><label>Employee Email (Optional)</label><input type="email" id="stgEmail" value="${escapeHTML(row.assignedEmployeeEmail || '')}"></div>
            <div style="display: flex; gap: 10px; margin-top: 24px; justify-content: flex-end;">
                <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
                <button type="submit" class="btn btn-primary" style="width: auto;">Save Staged Row</button>
            </div>
        </form>
    `;
    modal.style.display = 'flex';
}
window.openEditStagedModal = openEditStagedModal;

async function submitEditStaged(e, stagedId) {
    e.preventDefault();
    const data = {
        assetTag: document.getElementById('stgTag').value,
        serialNumber: document.getElementById('stgSerial').value,
        category: document.getElementById('stgCategory').value,
        location: document.getElementById('stgLocation').value,
        model: document.getElementById('stgModel').value,
        assignedEmployeeEmail: document.getElementById('stgEmail').value
    };

    const res = await fetch(`/api/import/staging/${stagedId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.ok) { closeModal(); loadStagingSandbox(); }
}
window.submitEditStaged = submitEditStaged;

async function deleteStagedRow(stagedId) {
    const res = await fetch(`/api/import/staging/${stagedId}`, { method: 'DELETE' });
    if (res.ok) loadStagingSandbox();
}
window.deleteStagedRow = deleteStagedRow;

function flushStagingSandbox() {
    if (!modalWrapper || !modal) return;
    modalWrapper.innerHTML = `
        <h3 style="color: var(--danger);">Clear Staging</h3>
        <p>Are you sure you want to clear all staged items? This action will not affect live production data.</p>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
            <button onclick="confirmFlushSandbox()" class="btn btn-danger" style="width: auto;">Clear Staging</button>
        </div>
    `;
    modal.style.display = 'flex';
}
window.flushStagingSandbox = flushStagingSandbox;

async function confirmFlushSandbox() {
    const res = await fetch(`/api/import/staging?site_id=${currentSiteId}`, { method: 'DELETE' });
    if (res.ok) { closeModal(); loadStagingSandbox(); }
}
window.confirmFlushSandbox = confirmFlushSandbox;

function pushStagingToProduction() {
    const validRows = stagedAssetsCache.filter(r => r.validationStatus === 'Valid');
    if (validRows.length === 0) {
        showNoticeModal('Action Required', 'There are no valid rows ready to import. Please resolve or remove error and duplicate rows first.', 'error');
        return;
    }
    if (!modalWrapper || !modal) return;

    modalWrapper.innerHTML = `
        <h3>Import Staged Items</h3>
        <p>You are about to write <strong>${validRows.length} valid item(s)</strong> directly into active production inventory.</p>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
            <button onclick="confirmPushToProduction()" class="btn btn-primary" style="width: auto;">Confirm & Import</button>
        </div>
    `;
    modal.style.display = 'flex';
}
window.pushStagingToProduction = pushStagingToProduction;

async function confirmPushToProduction() {
    try {
        const res = await fetch('/api/import/commit', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ site_id: currentSiteId })
        });
        const data = await res.json();
        
        if (res.ok) {
            closeModal();
            showNoticeModal('Transaction Complete', data.message || 'Batch successfully committed to live inventory.');
            loadStagingSandbox(); loadAssets(); loadOverviewTelemetry();
        } else {
            closeModal();
            showNoticeModal('Import Failed', data.error || 'Failed to import batch to live inventory.', 'error');
        }
    } catch (err) {
        closeModal(); showNoticeModal('System Error', 'Server error executing batch commit transaction.', 'error');
    }
}
window.confirmPushToProduction = confirmPushToProduction;

/* =========================================================
   ASSET MANAGEMENT MODALS
   ========================================================= */

function openLocationModal(assetId) {
    if (!modalWrapper || !modal) return;
    const targetAsset = allAssetsCache.find(a => a.id === assetId);
    if (!targetAsset) return;
    const currentLocation = targetAsset.location || 'Office';

    modalWrapper.innerHTML = `
        <h3>Change Setup Location</h3>
        <p>Update deployment setup location for asset <strong>${escapeHTML(targetAsset.assetTag)}</strong>.</p>
        <form onsubmit="submitAssetLocation(event, ${assetId})">
            <div class="form-group">
                <label>Select Location</label>
                <select id="newAssetLocation" required>
                    <option value="Office" ${currentLocation === 'Office' ? 'selected' : ''}>Corporate Office</option>
                    <option value="Work From Home" ${currentLocation === 'Work From Home' ? 'selected' : ''}>Work From Home (WFH)</option>
                </select>
            </div>
            <div style="display: flex; gap: 12px; margin-top: 28px; justify-content: flex-end;">
                <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
                <button type="submit" class="btn btn-primary" style="width: auto;">Update Location</button>
            </div>
        </form>
    `;
    modal.style.display = 'flex';
}
window.openLocationModal = openLocationModal;

async function submitAssetLocation(e, assetId) {
    e.preventDefault();
    const newLocation = document.getElementById('newAssetLocation')?.value;
    const targetAsset = allAssetsCache.find(a => a.id === assetId);
    if (!targetAsset || !newLocation) return;

    try {
        const res = await fetch(`/api/assets/${assetId}`, {
            method: 'PUT', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...targetAsset, location: newLocation })
        });
        if (res.ok) { 
            closeModal(); 
            loadAssets(); 
            loadOverviewTelemetry(); 
        } else { 
            const errData = await res.json(); 
            showNoticeModal('Update Failed', errData.error || 'Failed to update asset location.', 'error'); 
        }
    } catch (err) { 
        showNoticeModal('System Error', 'Server connection error updating location.', 'error'); 
    }
}
window.submitAssetLocation = submitAssetLocation;

async function openAssignModal(assetId) {
    if (!modalWrapper || !modal) return;
    if (!currentSiteId) {
        showNoticeModal('Site Required', 'Please select or create a site location context first.', 'error');
        return;
    }
    
    try {
        const res = await fetch(`/api/employees?site_id=${currentSiteId}`);
        const employees = await res.json();
        const empOptions = Array.isArray(employees) ? employees.map(e => `<option value="${e.id}">${escapeHTML(e.name)} (${escapeHTML(e.email)})</option>`).join('') : '';

        modalWrapper.innerHTML = `
            <h3>Assign Asset to Employee</h3>
            <form onsubmit="submitAssetAssignment(event, ${assetId})">
                <div class="form-group">
                    <label>Select Employee</label>
                    <select id="targetEmployeeId" required>
                        <option value="">-- Choose Employee --</option>
                        ${empOptions}
                    </select>
                </div>
                <div style="display: flex; gap: 12px; margin-top: 28px; justify-content: flex-end;">
                    <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
                    <button type="submit" class="btn btn-primary" style="width: auto;">Confirm Assignment</button>
                </div>
            </form>
        `;
        modal.style.display = 'flex';
    } catch (err) {
        showNoticeModal('Error', 'Unable to fetch employee list for assignment.', 'error');
    }
}
window.openAssignModal = openAssignModal;

async function submitAssetAssignment(e, assetId) {
    e.preventDefault();
    const empId = document.getElementById('targetEmployeeId')?.value;
    if (!empId) return;
    const targetAsset = allAssetsCache.find(a => a.id === assetId);
    if (!targetAsset) return;

    const res = await fetch(`/api/assets/${assetId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...targetAsset, status: 'Assigned', assignedEmployeeId: empId })
    });
    if (res.ok) { closeModal(); loadAssets(); loadOverviewTelemetry(); }
}
window.submitAssetAssignment = submitAssetAssignment;

function openStatusModal(assetId) {
    if (!modalWrapper || !modal) return;
    modalWrapper.innerHTML = `
        <h3>Update Asset Status</h3>
        <form onsubmit="submitAssetStatus(event, ${assetId})">
            <div class="form-group">
                <label>Select New Status</label>
                <select id="newAssetStatus" required>
                    <option value="Unassigned">Unassigned (Return to Stock)</option>
                    <option value="In Maintenance">In Maintenance (Send to Queue)</option>
                </select>
            </div>
            <div style="display: flex; gap: 12px; margin-top: 28px; justify-content: flex-end;">
                <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
                <button type="submit" class="btn btn-primary" style="width: auto;">Update Status</button>
            </div>
        </form>
    `;
    modal.style.display = 'flex';
}
window.openStatusModal = openStatusModal;

async function submitAssetStatus(e, assetId) {
    e.preventDefault();
    const status = document.getElementById('newAssetStatus')?.value;
    if (!status) return;
    const targetAsset = allAssetsCache.find(a => a.id === assetId);
    if (!targetAsset) return;

    const res = await fetch(`/api/assets/${assetId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...targetAsset, status: status, assignedEmployeeId: null })
    });
    if (res.ok) { closeModal(); loadAssets(); loadMaintenanceAssets(); loadOverviewTelemetry(); }
}
window.submitAssetStatus = submitAssetStatus;

function executeSingleDelete(assetId) {
    if (!modalWrapper || !modal) return;
    const targetAsset = allAssetsCache.find(a => a.id === assetId);
    const tagName = targetAsset ? escapeHTML(targetAsset.assetTag) : 'this asset';

    modalWrapper.innerHTML = `
        <h3 style="color: var(--danger);">Delete Asset</h3>
        <p>Are you sure you want to permanently delete asset <strong>${tagName}</strong>? This action cannot be undone.</p>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
            <button onclick="confirmSingleDelete(${assetId})" class="btn btn-danger" style="width: auto;">Delete Permanently</button>
        </div>
    `;
    modal.style.display = 'flex';
}
window.executeSingleDelete = executeSingleDelete;

async function confirmSingleDelete(assetId) {
    try {
        const res = await fetch(`/api/assets/${assetId}`, { method: 'DELETE' });
        if (res.ok) { closeModal(); loadAssets(); loadOverviewTelemetry(); } 
        else { const data = await res.json(); showNoticeModal('Delete Failed', data.error || 'Failed to delete asset.', 'error'); }
    } catch (err) { showNoticeModal('System Error', 'Server connection error while deleting asset.', 'error'); }
}
window.confirmSingleDelete = confirmSingleDelete;

async function openAssetModal(defaultCategory = 'Laptop') {
    if (!modalWrapper || !modal) return;
    if (!currentSiteId) {
        showNoticeModal('Site Context Required', 'Please select or create a site location context before registering hardware assets.', 'error');
        return;
    }

    try {
        const res = await fetch(`/api/employees?site_id=${currentSiteId}`);
        const employees = await res.json();
        const empOptions = Array.isArray(employees) ? employees.map(e => `<option value="${e.id}">${escapeHTML(e.name)} (${escapeHTML(e.email)})</option>`).join('') : '';

        const isLaptop = defaultCategory === 'Laptop' ? 'selected' : '';
        const isMonitor = defaultCategory === 'Monitor' ? 'selected' : '';
        const isPeripheral = defaultCategory === 'Peripheral' ? 'selected' : '';

        modalWrapper.innerHTML = `
            <h3>Register Hardware Asset</h3>
            <form onsubmit="submitAsset(event)">
                <div class="form-row">
                    <div class="form-group"><label>Asset Tag ID</label><input type="text" id="assetTag" required placeholder="e.g. AST-001"></div>
                    <div class="form-group"><label>Serial Number</label><input type="text" id="serialNumber" required placeholder="e.g. SN-882390"></div>
                </div>
                
                <div class="form-row">
                    <div class="form-group"><label>Category</label>
                        <select id="assetCategory" onchange="toggleCategorySpecificFields()">
                            <option value="Laptop" ${isLaptop}>Laptop</option>
                            <option value="Monitor" ${isMonitor}>Monitor / Display</option>
                            <option value="Peripheral" ${isPeripheral}>Peripheral</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>
                    <div class="form-group" id="locationGroup" style="display: ${defaultCategory === 'Monitor' ? 'block' : 'none'};">
                        <label>Deployment Setup</label>
                        <select id="assetLocation">
                            <option value="Office">Corporate Office</option>
                            <option value="Work From Home">Work From Home (WFH)</option>
                        </select>
                    </div>
                </div>

                <div class="form-group"><label>Hardware Model</label><input type="text" id="model" required placeholder="e.g. ThinkPad T14 / Dell P2419H"></div>

                <div id="warrantyGroup" class="form-row" style="display: ${defaultCategory === 'Laptop' ? 'grid' : 'none'};">
                    <div class="form-group"><label>Warranty Start Date</label><input type="date" id="warrantyStart"></div>
                    <div class="form-group"><label>Warranty End Date</label><input type="date" id="warrantyEnd"></div>
                </div>

                <div class="form-group"><label>Assign to Employee (Optional)</label>
                    <select id="assignedEmployeeId">
                        <option value="">-- Leave Unassigned --</option>
                        ${empOptions}
                    </select>
                </div>
                <div style="display: flex; gap: 12px; margin-top: 28px; justify-content: flex-end;">
                    <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
                    <button type="submit" class="btn btn-primary" style="width: auto;">Save Asset</button>
                </div>
            </form>
        `;
        modal.style.display = 'flex';
    } catch (err) {
        showNoticeModal('System Error', 'Failed to initialize asset registration form.', 'error');
    }
}
window.openAssetModal = openAssetModal;

function toggleCategorySpecificFields() {
    const category = document.getElementById('assetCategory')?.value;
    const warrantyGroup = document.getElementById('warrantyGroup');
    const locationGroup = document.getElementById('locationGroup');

    if (warrantyGroup) { warrantyGroup.style.display = category === 'Laptop' ? 'grid' : 'none'; }
    if (locationGroup) { locationGroup.style.display = category === 'Monitor' ? 'block' : 'none'; }
}
window.toggleCategorySpecificFields = toggleCategorySpecificFields;

async function submitAsset(e) {
    e.preventDefault();
    if (!currentSiteId) {
        showNoticeModal('Site Context Required', 'Please select or create a site location first.', 'error');
        return;
    }

    const category = document.getElementById('assetCategory')?.value || 'Laptop';
    const locationEl = document.getElementById('assetLocation');
    const locationValue = (category === 'Monitor' && locationEl) ? locationEl.value : 'Office';

    const data = {
        assetTag: document.getElementById('assetTag').value,
        serialNumber: document.getElementById('serialNumber').value,
        category: category,
        location: locationValue,
        model: document.getElementById('model').value,
        assignedEmployeeId: document.getElementById('assignedEmployeeId')?.value || null,
        warrantyStart: category === 'Laptop' ? document.getElementById('warrantyStart')?.value : null,
        warrantyEnd: category === 'Laptop' ? document.getElementById('warrantyEnd')?.value : null,
        site_id: currentSiteId
    };

    const res = await fetch('/api/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.ok) { closeModal(); loadAssets(); loadOverviewTelemetry(); }
    else { const errData = await res.json(); showNoticeModal('Registration Failed', errData.error || 'Failed to save hardware asset.', 'error'); }
}
window.submitAsset = submitAsset;

/* =========================================================
   USER GOVERNANCE & INTERACTIVE SITE BADGES
   ========================================================= */

async function loadSystemUsers() {
    if (currentUserRole !== 'ADMIN') return;
    try {
        const res = await fetch('/api/users');
        if (res.status === 401) return;
        allSystemUsersCache = await res.json();
        
        const tbody = document.getElementById('systemUsersTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (!allSystemUsersCache || allSystemUsersCache.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">No system users registered.</td></tr>`;
            return;
        }

        allSystemUsersCache.forEach(usr => {
            const tr = document.createElement('tr');
            const badgeClass = usr.role === 'ADMIN' ? 'admin' : usr.role === 'STAFF' ? 'staff' : 'viewer';
            const youLabel = usr.id === currentUserId ? '<span style="color: var(--text-secondary); margin-left: 4px;">(You)</span>' : '';

            let sitesBadgeHtml = '';
            if (usr.role === 'ADMIN') {
                sitesBadgeHtml = `<span class="badge staff" style="background: #EEF2FF; color: #4F46E5; border: 1px solid #C7D2FE;">All Sites (Global Admin)</span>`;
            } else if (usr.assignedSites && usr.assignedSites.length > 0) {
                sitesBadgeHtml = usr.assignedSites.map(s => {
                    const code = escapeHTML(s.site_code || s.site_name);
                    const name = escapeHTML(usr.name);
                    return `<span class="badge viewer site-access-badge" style="margin-right: 4px;" title="Click × to revoke ${code} access">
                        ${code}
                        <span class="revoke-badge-btn" onclick="event.stopPropagation(); removeUserSiteAccess(${s.id}, ${usr.id}, '${code}', '${name}')">&times;</span>
                    </span>`;
                }).join('');
            } else {
                sitesBadgeHtml = `<em style="color: var(--text-secondary); font-size: 12px;">No Sites Assigned</em>`;
            }

            tr.innerHTML = `
                <td><strong>${escapeHTML(usr.name)}</strong> ${youLabel}</td>
                <td>${escapeHTML(usr.email)}</td>
                <td><span class="badge ${badgeClass}">${escapeHTML(usr.role)}</span></td>
                <td>${sitesBadgeHtml}</td>
                <td><span class="badge open">Active</span></td>
                <td style="text-align: right;">${renderUserRowDropdown(usr.id)}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) { 
        console.error('Failed to load system users:', err); 
    }
}

function renderUserRowDropdown(userId) {
    return `
        <div class="row-action-menu" style="position: relative; display: inline-block;">
            <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px; width: auto;" onclick="toggleRowDropdown(event, 'usr-${userId}')">
                Manage Access &#9662;
            </button>
            <div id="rowDropdown-usr-${userId}" class="row-dropdown">
                <button class="dropdown-item" onclick="openEditUserModal(${userId})">Edit Profile</button>
                <button class="dropdown-item" onclick="openResetPasswordModal(${userId})">Reset Password</button>
                <div style="height: 1px; background: var(--border-color); margin: 4px 0;"></div>
                <button class="dropdown-item" style="color: var(--danger);" onclick="executeUserDelete(${userId})">Revoke Access</button>
            </div>
        </div>
    `;
}

async function openRegisterUserModal() {
    if (!modalWrapper || !modal) return;
    
    if (!allSitesCache || allSitesCache.length === 0) {
        try {
            const res = await fetch('/api/sites');
            if (res.ok) allSitesCache = await res.json();
        } catch (e) {
            console.error('Failed to pre-fetch site list for register modal:', e);
        }
    }

    const siteOptions = (allSitesCache || []).map(s => 
        `<option value="${s.id}">${escapeHTML(s.site_code)} - ${escapeHTML(s.site_name)}</option>`
    ).join('');

    modalWrapper.innerHTML = `
        <h3>Register System User</h3>
        <form onsubmit="submitNewUser(event)">
            <div class="form-group"><label>Full Name</label><input type="text" id="newUsrName" required placeholder="Jane Doe"></div>
            <div class="form-group"><label>Email Address</label><input type="email" id="newUsrEmail" required placeholder="jane@company.com"></div>
            <div class="form-group"><label>Initial Password</label><input type="password" id="newUsrPass" required placeholder="••••••••"></div>
            
            <div class="form-row">
                <div class="form-group"><label>Access Role</label>
                    <select id="newUsrRole" required>
                        <option value="STAFF">STAFF (Read/Write Operations)</option>
                        <option value="ADMIN">ADMIN (Full Control & User Management)</option>
                        <option value="VIEWER">VIEWER (Read Only)</option>
                    </select>
                </div>
                <div class="form-group"><label>Assign Initial Site</label>
                    <select id="newUsrSite">
                        <option value="">-- Optional Site Assignment --</option>
                        ${siteOptions}
                    </select>
                </div>
            </div>

            <div style="display: flex; gap: 12px; margin-top: 28px; justify-content: flex-end;">
                <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
                <button type="submit" id="btnSubmitNewUser" class="btn btn-primary" style="width: auto;">Register User</button>
            </div>
        </form>
    `;
    modal.style.display = 'flex';
}
window.openRegisterUserModal = openRegisterUserModal;

async function submitNewUser(e) {
    e.preventDefault();
    const submitBtn = document.getElementById('btnSubmitNewUser');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="spinner-sm"></span> Registering...`;
    }

    const nameEl = document.getElementById('newUsrName');
    const emailEl = document.getElementById('newUsrEmail');
    const passEl = document.getElementById('newUsrPass');
    const roleEl = document.getElementById('newUsrRole');
    const siteEl = document.getElementById('newUsrSite');

    const data = {
        name: nameEl ? nameEl.value : '',
        email: emailEl ? emailEl.value : '',
        password: passEl ? passEl.value : '',
        role: roleEl ? roleEl.value : 'STAFF',
        site_id: (siteEl && siteEl.value) ? siteEl.value : null
    };

    try {
        const res = await fetch('/api/users', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(data) 
        });
        if (res.ok) { 
            closeModal(); 
            loadSystemUsers(); 
        } else { 
            const errData = await res.json(); 
            showNoticeModal('Registration Failed', errData.error || 'Failed to register user.', 'error'); 
        }
    } catch (err) {
        showNoticeModal('System Error', 'Server connection error while registering user.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Register User';
        }
    }
}
window.submitNewUser = submitNewUser;

function openEditUserModal(userId) {
    if (!modalWrapper || !modal) return;
    const usr = allSystemUsersCache.find(u => u.id === userId);
    if (!usr) return;

    const isStaff = usr.role === 'STAFF' ? 'selected' : '';
    const isAdmin = usr.role === 'ADMIN' ? 'selected' : '';
    const isViewer = usr.role === 'VIEWER' ? 'selected' : '';

    modalWrapper.innerHTML = `
        <h3>Edit User Profile</h3>
        <form onsubmit="submitEditUser(event, ${userId})">
            <div class="form-group"><label>Full Name</label><input type="text" id="editUsrName" value="${escapeHTML(usr.name)}" required></div>
            <div class="form-group"><label>Email Address</label><input type="email" id="editUsrEmail" value="${escapeHTML(usr.email)}" required></div>
            <div class="form-group"><label>Access Privilege Role</label>
                <select id="editUsrRole" required>
                    <option value="STAFF" ${isStaff}>STAFF (Scoped to Assigned Sites)</option>
                    <option value="ADMIN" ${isAdmin}>ADMIN (Global Access to All Sites)</option>
                    <option value="VIEWER" ${isViewer}>VIEWER (Read Only Scoped)</option>
                </select>
            </div>
            <div style="display: flex; gap: 12px; margin-top: 28px; justify-content: flex-end;">
                <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
                <button type="submit" class="btn btn-primary" style="width: auto;">Save Changes</button>
            </div>
        </form>
    `;
    modal.style.display = 'flex';
}
window.openEditUserModal = openEditUserModal;

async function submitEditUser(e, userId) {
    e.preventDefault();
    const data = {
        name: document.getElementById('editUsrName')?.value,
        email: document.getElementById('editUsrEmail')?.value,
        role: document.getElementById('editUsrRole')?.value
    };
    const res = await fetch(`/api/users/${userId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.ok) { closeModal(); loadSystemUsers(); }
}
window.submitEditUser = submitEditUser;

function openResetPasswordModal(userId) {
    if (!modalWrapper || !modal) return;
    modalWrapper.innerHTML = `
        <h3>Force Password Reset</h3>
        <form onsubmit="submitResetPassword(event, ${userId})">
            <div class="form-group"><label>New Password</label><input type="password" id="resetUsrPass" required placeholder="Enter new password"></div>
            <div style="display: flex; gap: 12px; margin-top: 28px; justify-content: flex-end;">
                <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
                <button type="submit" class="btn btn-primary" style="width: auto;">Update Password</button>
            </div>
        </form>
    `;
    modal.style.display = 'flex';
}
window.openResetPasswordModal = openResetPasswordModal;

async function submitResetPassword(e, userId) {
    e.preventDefault();
    const password = document.getElementById('resetUsrPass')?.value;
    const res = await fetch(`/api/users/${userId}/password`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    if (res.ok) { closeModal(); loadSystemUsers(); }
}
window.submitResetPassword = submitResetPassword;

function executeUserDelete(userId) {
    if (userId === currentUserId) { showNoticeModal('Action Prohibited', 'You cannot revoke access to your own active logged-in session.', 'error'); return; }
    if (!modalWrapper || !modal) return;
    const usr = allSystemUsersCache.find(u => u.id === userId);
    const userName = usr ? escapeHTML(usr.name) : 'this user';

    modalWrapper.innerHTML = `
        <h3 style="color: var(--danger);">Revoke System Access</h3>
        <p>Permanently delete system account for <strong>${userName}</strong>? They will immediately lose access to the hub.</p>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
            <button onclick="confirmUserDelete(${userId})" class="btn btn-danger" style="width: auto;">Revoke Access</button>
        </div>
    `;
    modal.style.display = 'flex';
}
window.executeUserDelete = executeUserDelete;

async function confirmUserDelete(userId) {
    const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
    if (res.ok) { closeModal(); loadSystemUsers(); }
}
window.confirmUserDelete = confirmUserDelete;

/* =========================================================
   DIRECTORY & TEAMS
   ========================================================= */

async function loadEmployees() {
    if (!currentSiteId) return;
    try {
        const res = await fetch(`/api/employees?site_id=${currentSiteId}`);
        if (res.status === 401) return;
        const employees = await res.json();
        const tbody = document.getElementById('employeeTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (!Array.isArray(employees) || employees.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">No employees registered in this site.</td></tr>`;
            return;
        }

        employees.forEach(emp => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${escapeHTML(emp.name)}</strong></td>
                <td>${escapeHTML(emp.email)}</td>
                <td>${escapeHTML(emp.teamName || 'Unassigned Team')}</td>
                <td>
                    <button onclick="openEmployeeProfile(${emp.id})" class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px; width: auto;">View Profile</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) { console.error('Failed to load employees:', err); }
}

async function loadTeams() {
    try {
        const res = await fetch('/api/teams');
        if (res.status === 401) return;
        const teams = await res.json();
        const container = document.getElementById('teamListContainer');
        if (!container) return;
        container.innerHTML = '';

        if (!Array.isArray(teams) || teams.length === 0) {
            container.innerHTML = `<p style="font-size: 13px; color: var(--text-secondary);">No teams created yet.</p>`;
            return;
        }

        teams.forEach(team => {
            const div = document.createElement('div');
            div.style.cssText = "padding: 16px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-main);";
            div.innerHTML = `
                <strong style="font-size: 14px; display: block; color: var(--text-primary); margin-bottom: 4px;">${escapeHTML(team.teamName)}</strong>
                <span style="font-size: 13px; color: var(--text-secondary);">${escapeHTML(team.description || 'No description provided.')}</span>
            `;
            container.appendChild(div);
        });
    } catch (err) { console.error('Failed to load teams:', err); }
}

async function openEmployeeProfile(empId) {
    if (!modalWrapper || !modal) return;
    const res = await fetch(`/api/employees/${empId}`);
    if (!res.ok) return;
    const { employee, assets } = await res.json();
    
    let assetsHtml = !Array.isArray(assets) || assets.length === 0 ? 
        '<p style="font-size: 13px; color: var(--text-secondary);">No assets currently assigned.</p>' :
        '<ul style="list-style: none; padding: 0; margin: 0; font-size: 13px;">' + 
        assets.map(a => `<li style="padding: 6px 0; border-bottom: 1px solid var(--border-color);"><strong>${escapeHTML(a.assetTag)}</strong> - ${escapeHTML(a.category)} (${escapeHTML(a.model)})</li>`).join('') + 
        '</ul>';

    modalWrapper.innerHTML = `
        <h3>Employee Profile</h3>
        <div style="margin-bottom: 20px;">
            <p><strong>Name:</strong> ${escapeHTML(employee.name)}</p>
            <p><strong>Email:</strong> ${escapeHTML(employee.email)}</p>
            <p><strong>Team:</strong> ${escapeHTML(employee.teamName || 'Unassigned')}</p>
        </div>
        <h4>Assigned Hardware</h4>
        <div style="background: var(--bg-main); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); max-height: 200px; overflow-y: auto;">
            ${assetsHtml}
        </div>
        <div style="display: flex; justify-content: flex-end; margin-top: 24px;">
            <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Close Profile</button>
        </div>
    `;
    modal.style.display = 'flex';
}
window.openEmployeeProfile = openEmployeeProfile;

async function openEmployeeModal() {
    if (!modalWrapper || !modal) return;
    if (!currentSiteId) {
        showNoticeModal('Site Context Required', 'Please select or create a site location first.', 'error');
        return;
    }

    try {
        const res = await fetch('/api/teams');
        const teams = await res.json();
        const teamOptions = Array.isArray(teams) ? teams.map(t => `<option value="${t.id}">${escapeHTML(t.teamName)}</option>`).join('') : '';

        modalWrapper.innerHTML = `
            <h3>Register Employee</h3>
            <form onsubmit="submitEmployee(event)">
                <div class="form-group"><label>Full Name</label><input type="text" id="newEmpName" required placeholder="John Doe"></div>
                <div class="form-group"><label>Email Address</label><input type="email" id="newEmpEmail" required placeholder="john@company.com"></div>
                <div class="form-group"><label>Assign Team</label>
                    <select id="newEmpTeam">
                        <option value="">-- No Team --</option>
                        ${teamOptions}
                    </select>
                </div>
                <div style="display: flex; gap: 12px; margin-top: 28px; justify-content: flex-end;">
                    <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
                    <button type="submit" class="btn btn-primary" style="width: auto;">Save Employee</button>
                </div>
            </form>
        `;
        modal.style.display = 'flex';
    } catch (err) {
        showNoticeModal('Error', 'Unable to fetch team list.', 'error');
    }
}
window.openEmployeeModal = openEmployeeModal;

async function submitEmployee(e) {
    e.preventDefault();
    if (!currentSiteId) return;
    const data = {
        name: document.getElementById('newEmpName')?.value,
        email: document.getElementById('newEmpEmail')?.value,
        teamId: document.getElementById('newEmpTeam')?.value || null,
        site_id: currentSiteId
    };
    const res = await fetch('/api/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.ok) { closeModal(); loadEmployees(); }
    else { const errData = await res.json(); showNoticeModal('Error', errData.error || 'Failed to register employee.', 'error'); }
}
window.submitEmployee = submitEmployee;

function openTeamModal() {
    if (!modalWrapper || !modal) return;
    modalWrapper.innerHTML = `
        <h3>Create New Team</h3>
        <form onsubmit="submitTeam(event)">
            <div class="form-group"><label>Team Name</label><input type="text" id="newTeamName" required placeholder="e.g. Engineering"></div>
            <div class="form-group"><label>Description</label><input type="text" id="newTeamDesc" placeholder="Optional brief description"></div>
            <div style="display: flex; gap: 12px; margin-top: 28px; justify-content: flex-end;">
                <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
                <button type="submit" class="btn btn-primary" style="width: auto;">Create Team</button>
            </div>
        </form>
    `;
    modal.style.display = 'flex';
}
window.openTeamModal = openTeamModal;

async function submitTeam(e) {
    e.preventDefault();
    const data = { teamName: document.getElementById('newTeamName')?.value, description: document.getElementById('newTeamDesc')?.value };
    const res = await fetch('/api/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.ok) { closeModal(); loadTeams(); }
    else { const errData = await res.json(); showNoticeModal('Error', errData.error || 'Failed to create team.', 'error'); }
}
window.submitTeam = submitTeam;

/* =========================================================
   MAINTENANCE PIPELINE
   ========================================================= */

async function loadMaintenanceAssets() {
    if (!currentSiteId) return;
    try {
        const res = await fetch(`/api/assets?site_id=${currentSiteId}`);
        if (res.status === 401) return;
        const assets = await res.json();
        const tbody = document.getElementById('maintenanceTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        const maintAssets = Array.isArray(assets) ? assets.filter(a => a.status === 'In Maintenance') : [];
        if (maintAssets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">No hardware currently in maintenance.</td></tr>`;
            return;
        }

        maintAssets.forEach(asset => {
            const tr = document.createElement('tr');
            let actionHtml = currentUserRole === 'VIEWER' ? '<em style="font-size: 11px; color: var(--text-secondary);">Read Only</em>' : 
                `<button onclick="resolveMaintenance(${asset.id}, '${escapeHTML(asset.assetTag)}', '${escapeHTML(asset.serialNumber)}', '${escapeHTML(asset.category)}', '${escapeHTML(asset.model)}', '${escapeHTML(asset.warrantyStart || '')}', '${escapeHTML(asset.warrantyEnd || '')}')" class="btn btn-primary" style="padding: 6px 12px; font-size: 12px; width: auto;">Resolve</button>`;

            tr.innerHTML = `
                <td><strong>${escapeHTML(asset.assetTag)}</strong></td>
                <td>${escapeHTML(asset.category)} (${escapeHTML(asset.model)})</td>
                <td>${escapeHTML(asset.serialNumber)}</td>
                <td><span class="badge high">In Maintenance</span></td>
                <td>${actionHtml}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) { console.error('Failed to load maintenance queue:', err); }
}

function resolveMaintenance(id, tag, serial, category, model, wStart, wEnd) {
    if (!modalWrapper || !modal) return;
    
    modalWrapper.innerHTML = `
        <h3>Resolve Maintenance</h3>
        <p>Return asset <strong>${escapeHTML(tag)}</strong> back to unassigned stock?</p>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button type="button" onclick="closeModal()" class="btn btn-secondary" style="width: auto;">Cancel</button>
            <button onclick="confirmResolveMaintenance(${id}, '${escapeHTML(tag)}', '${escapeHTML(serial)}', '${escapeHTML(category)}', '${escapeHTML(model)}', '${escapeHTML(wStart)}', '${escapeHTML(wEnd)}')" class="btn btn-primary" style="width: auto;">Confirm & Return</button>
        </div>
    `;
    modal.style.display = 'flex';
}
window.resolveMaintenance = resolveMaintenance;

async function confirmResolveMaintenance(id, tag, serial, category, model, wStart, wEnd) {
    const res = await fetch(`/api/assets/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetTag: tag, serialNumber: serial, category, model, status: 'Unassigned', assignedEmployeeId: null, warrantyStart: wStart, warrantyEnd: wEnd })
    });
    if (res.ok) { closeModal(); loadMaintenanceAssets(); loadAssets(); loadOverviewTelemetry(); }
}
window.confirmResolveMaintenance = confirmResolveMaintenance;

/* =========================================================
   UTILITIES & EXPORT
   ========================================================= */

function closeModal() { if (modal) modal.style.display = 'none'; }
window.closeModal = closeModal;

function showNoticeModal(title, message, type = 'info') {
    if (!modalWrapper || !modal) return;
    const titleColor = type === 'error' ? 'color: var(--danger);' : 'color: var(--text-primary);';

    modalWrapper.innerHTML = `
        <h3 style="${titleColor}">${escapeHTML(title)}</h3>
        <p>${escapeHTML(message)}</p>
        <div style="display: flex; justify-content: flex-end;">
            <button type="button" onclick="closeModal()" class="btn btn-primary" style="width: auto;">Acknowledge</button>
        </div>
    `;
    modal.style.display = 'flex';
}
window.showNoticeModal = showNoticeModal;

function calculateWarrantyStatus(endDateStr) {
    if (!endDateStr) return `<span class="badge viewer">N/A</span>`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = new Date(endDateStr);
    if (isNaN(end.getTime())) return `<span class="badge viewer">N/A</span>`;
    if (end >= today) return `<span class="badge open">Active</span>`;
    else return `<span class="badge high">Expired</span>`;
}

function exportInventory() {
    if (!currentSiteId) {
        showNoticeModal('Site Context Required', 'Please select a site before exporting.', 'error');
        return;
    }
    window.location.href = `/api/export?site_id=${currentSiteId}`;
}
window.exportInventory = exportInventory;