// ============================================================================
// Sxarf AI Admin Console - Frontend Application Logic (Bulletproof Edition)
// ============================================================================

const SUPABASE_URL = 'https://toduyybsfaxgidehogbe.supabase.co';
// Public Anon Key - Safe for client-side usage
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZHV5eWJzZmF4Z2lkZWhvZ2JlIiwicm9sZSI6ImFub24iLCJpYXQiOjV9.placeholder_key_replace_with_actual_anon_jwt'; 

// Initialize Supabase Client with explicit localStorage and flow type
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
        flowType: 'pkce' // Ensures secure authorization code flow
    }
});

// State
let currentUser = null;
let currentModalAction = null;

// DOM Elements
const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const googleLoginBtn = document.getElementById('google-login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authError = document.getElementById('auth-error');
const userEmailSpan = document.getElementById('user-email');

// Navigation Tabs
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    setupNavigation();
    setupEventListeners();

    // 1. Bulletproof PKCE Code Interceptor for GitHub Pages redirection
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');

    if (authCode) {
        console.log("Detected PKCE auth code in URL, forcing session exchange...");
        try {
            const { data, error } = await supabaseClient.auth.exchangeCodeForSession(window.location.href);
            if (error) throw error;
            console.log("Successfully exchanged code for session:", data.session);
            // Clean URL query parameters to avoid loop/reuse issues
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (err) {
            console.error("Code exchange failed:", err);
            showAuthError("Authentication code exchange failed: " + err.message);
        }
    }

    // 2. Check existing session
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    console.log("Initial getSession result:", session, error);

    if (session) {
        await handleSuccessfulAuth(session);
    } else {
        showAuthView();
    }

    // 3. Listen for auth state changes
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        console.log("Auth state change event:", event, session);
        if (session) {
            await handleSuccessfulAuth(session);
        } else {
            showAuthView();
        }
    });
});

function setupNavigation() {
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tabName = item.getAttribute('data-tab');
            
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            tabContents.forEach(tab => tab.classList.remove('active'));
            document.getElementById(`tab-${tabName}`).classList.add('active');

            // Load data for specific tabs
            loadTabData(tabName);
        });
    });
}

function showAuthView() {
    authView.classList.remove('hidden');
    appView.classList.add('hidden');
}

async function handleSuccessfulAuth(session) {
    currentUser = session.user;
    userEmailSpan.textContent = currentUser.email;

    // Verify admin privileges server-side via private.is_admin() or overview stats RPC
    try {
        console.log("Verifying admin privileges via RPC...");
        const { data, error } = await supabaseClient.rpc('admin_get_overview_stats');
        if (error) throw error;

        console.log("Admin verification passed. Launching console.");
        authView.classList.add('hidden');
        appView.classList.remove('hidden');
        loadTabData('overview');
    } catch (err) {
        console.error('Admin authorization check failed:', err);
        showAuthError(`Access Denied: Account (${currentUser.email}) does not possess administrator privileges.`);
        await supabaseClient.auth.signOut();
        showAuthView();
    }
}

function showAuthError(msg) {
    authError.textContent = msg;
    authError.classList.remove('hidden');
}

function setupEventListeners() {
    googleLoginBtn.addEventListener('click', async () => {
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.href.split('#')[0].split('?')[0]
            }
        });
        if (error) showAuthError(error.message);
    });

    logoutBtn.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
    });

    // Account Search
    document.getElementById('account-search-btn').addEventListener('click', () => {
        const query = document.getElementById('account-search-input').value.trim();
        loadAccounts(query);
    });

    // Capabilities
    document.getElementById('cap-submit-btn').addEventListener('click', async () => {
        const userId = document.getElementById('cap-user-input').value.trim();
        const capsStr = document.getElementById('cap-list-input').value.trim();
        if (!userId || !capsStr) return alert('Please enter User ID and capabilities.');
        const caps = capsStr.split(',').map(s => s.trim()).filter(Boolean);

        const { data, error } = await supabaseClient.rpc('admin_give_limited', {
            p_user_id: userId,
            p_capabilities: caps
        });
        if (error) alert('Error: ' + error.message);
        else {
            alert('Capabilities granted successfully.');
            document.getElementById('cap-user-input').value = '';
            document.getElementById('cap-list-input').value = '';
        }
    });

    // Gift Cards Generation
    document.getElementById('gc-generate-btn').addEventListener('click', async () => {
        const plan = document.getElementById('gc-plan').value;
        const duration = document.getElementById('gc-duration').value;
        const count = parseInt(document.getElementById('gc-count').value, 10) || 1;
        const note = document.getElementById('gc-note').value.trim();

        const { data, error } = await supabaseClient.rpc('admin_generate_gift_cards', {
            p_plan: plan,
            p_duration: duration,
            p_capabilities: ['chat', 'vision', 'advanced_models'],
            p_count: count,
            p_note: note
        });

        if (error) alert('Error generating gift cards: ' + error.message);
        else {
            document.getElementById('gc-results-container').classList.remove('hidden');
            document.getElementById('gc-generated-output').value = JSON.stringify(data, null, 2);
        }
    });

    // Disclaimers
    document.getElementById('disclaimer-send-one').addEventListener('click', async () => {
        const targetId = document.getElementById('disclaimer-target').value.trim();
        const message = document.getElementById('disclaimer-message').value.trim();
        if (!targetId || !message) return alert('Target user UUID and message are required.');

        const { error } = await supabaseClient.rpc('admin_send_disclaimer_to', {
            p_user_id: targetId,
            p_message: message
        });
        if (error) alert('Error: ' + error.message);
        else {
            alert('Disclaimer sent to user successfully.');
            document.getElementById('disclaimer-message').value = '';
        }
    });

    document.getElementById('disclaimer-send-all').addEventListener('click', async () => {
        const message = document.getElementById('disclaimer-message').value.trim();
        if (!message) return alert('Message content is required.');

        const { error } = await supabaseClient.rpc('admin_send_disclaimer_to_all_accounts', {
            p_message: message
        });
        if (error) alert('Error: ' + error.message);
        else {
            alert('Broadcast disclaimer sent to all accounts.');
            document.getElementById('disclaimer-message').value = '';
        }
    });

    // Public Access
    document.getElementById('public-shutdown-btn').addEventListener('click', async () => {
        const msg = document.getElementById('public-shutdown-msg').value.trim();
        openModal('Shut Down Public Access', 'Are you sure you want to disable public access to Sxarf AI?', async () => {
            const { error } = await supabaseClient.rpc('admin_shut_down_public_access', { p_message: msg });
            if (error) alert('Error: ' + error.message);
            else {
                alert('Public access shut down successfully.');
                loadTabData('publicaccess');
            }
        });
    });

    document.getElementById('public-restore-btn').addEventListener('click', async () => {
        const { error } = await supabaseClient.rpc('admin_start_public_access');
        if (error) alert('Error: ' + error.message);
        else {
            alert('Public access restored successfully.');
            loadTabData('publicaccess');
        }
    });

    // Modal buttons
    document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('modal-confirm-btn').addEventListener('click', () => {
        if (currentModalAction) currentModalAction();
        closeModal();
    });
}

async function loadTabData(tabName) {
    switch (tabName) {
        case 'overview':
            await loadOverviewStats();
            break;
        case 'accounts':
            await loadAccounts();
            break;
        case 'publicaccess':
            await loadPublicAccessState();
            break;
        case 'redemptions':
            await loadRedemptions();
            break;
        case 'auditlog':
            await loadAuditLogs();
            break;
        case 'settings':
            document.getElementById('config-url').value = SUPABASE_URL;
            document.getElementById('config-key').value = SUPABASE_ANON_KEY;
            break;
    }
}

async function loadOverviewStats() {
    const { data, error } = await supabaseClient.rpc('admin_get_overview_stats');
    if (error) return console.error(error);

    document.getElementById('stat-total-accounts').textContent = data.total_accounts ?? 0;
    document.getElementById('stat-active-subs').textContent = data.active_subscriptions ?? 0;
    document.getElementById('stat-expired-subs').textContent = data.expired_subscriptions ?? 0;
    document.getElementById('stat-suspended').textContent = data.suspended_accounts ?? 0;
    document.getElementById('stat-terminated').textContent = data.terminated_accounts ?? 0;
    document.getElementById('stat-gc-gen').textContent = data.gift_cards_generated ?? 0;
}

async function loadAccounts(query = '') {
    const { data, error } = await supabaseClient.rpc('admin_search_accounts', { p_query: query, p_limit: 100 });
    const tbody = document.getElementById('accounts-table-body');
    tbody.innerHTML = '';

    if (error || !data) {
        tbody.innerHTML = `<tr><td colspan="5">Error loading accounts</td></tr>`;
        return;
    }

    data.forEach(acc => {
        let statusBadge = '<span class="badge badge-active">Active</span>';
        if (acc.is_terminated) statusBadge = '<span class="badge badge-terminated">Terminated</span>';
        else if (acc.is_suspended) statusBadge = '<span class="badge badge-suspended">Suspended</span>';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${acc.email || 'No email'}</strong><br><small style="color:var(--text-muted);font-family:var(--font-mono);">${acc.id}</small></td>
            <td><code>${acc.plan || 'free'}</code></td>
            <td>${acc.plan_expires_at ? new Date(acc.plan_expires_at).toLocaleDateString() : 'Never'}</td>
            <td>${statusBadge}</td>
            <td>
                <button class="btn btn-secondary" onclick="actionRevoke('${acc.id}')" style="padding:4px 8px;font-size:11px;">Revoke</button>
                <button class="btn btn-secondary" onclick="actionUpgrade('${acc.id}')" style="padding:4px 8px;font-size:11px;">Upgrade</button>
                ${acc.is_suspended ? 
                    `<button class="btn btn-success" onclick="actionUnsuspend('${acc.id}')" style="padding:4px 8px;font-size:11px;">Unsuspend</button>` : 
                    `<button class="btn btn-secondary" onclick="actionSuspend('${acc.id}')" style="padding:4px 8px;font-size:11px;">Suspend</button>`
                }
                <button class="btn btn-danger" onclick="actionTerminate('${acc.id}')" style="padding:4px 8px;font-size:11px;">Terminate</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Account Action Handlers attached globally
window.actionRevoke = async (userId) => {
    if (!confirm('Revoke plan for this account and revert to Free?')) return;
    const { error } = await supabaseClient.rpc('admin_revoke_account', { p_user_id: userId });
    if (error) alert('Error: ' + error.message);
    else { alert('Account revoked successfully.'); loadAccounts(); }
};

window.actionUpgrade = async (userId) => {
    const plan = prompt('Enter target plan (starter, pro, enterprise):', 'pro');
    if (!plan) return;
    const { error } = await supabaseClient.rpc('admin_upgrade_account', { p_user_id: userId, p_plan: plan });
    if (error) alert('Error: ' + error.message);
    else { alert('Account upgraded successfully.'); loadAccounts(); }
};

window.actionSuspend = async (userId) => {
    const reason = prompt('Enter suspension reason:', 'Administrative suspension');
    const { error } = await supabaseClient.rpc('admin_suspend_account', { p_user_id: userId, p_reason: reason });
    if (error) alert('Error: ' + error.message);
    else { alert('Account suspended successfully.'); loadAccounts(); }
};

window.actionUnsuspend = async (userId) => {
    const { error } = await supabaseClient.rpc('admin_unsuspend_account', { p_user_id: userId });
    if (error) alert('Error: ' + error.message);
    else { alert('Account unsuspended successfully.'); loadAccounts(); }
};

window.actionTerminate = async (userId) => {
    const reason = prompt('CRITICAL: Permanent termination reason:', 'Violation of terms');
    if (!reason) return;
    const { error } = await supabaseClient.rpc('admin_terminate_account', { p_user_id: userId, p_reason: reason });
    if (error) alert('Error: ' + error.message);
    else { alert('Account terminated permanently.'); loadAccounts(); }
};

async function loadPublicAccessState() {
    const { data, error } = await supabaseClient.rpc('admin_get_overview_stats');
    if (error || !data) return;
    const pa = data.public_access;
    const badge = document.getElementById('public-access-status-badge');
    if (pa.enabled) {
        badge.textContent = 'ONLINE (Public Access Enabled)';
        badge.className = 'badge badge-active';
    } else {
        badge.textContent = 'SHUT DOWN: ' + (pa.message || 'Maintenance mode');
        badge.className = 'badge badge-suspended';
    }
}

async function loadRedemptions() {
    const { data, error } = await supabaseClient.rpc('admin_redemption_history', { p_limit: 100 });
    const tbody = document.getElementById('redemptions-table-body');
    tbody.innerHTML = '';
    if (error || !data) {
        tbody.innerHTML = `<tr><td colspan="5">No redemption records or unsupported RPC</td></tr>`;
        return;
    }
    data.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code>${r.id || r.code_id || '-'}</code></td>
            <td>${r.plan || '-'}</td>
            <td>${r.duration || '-'}</td>
            <td>${r.redeemed_by || '-'}</td>
            <td>${r.redeemed_at ? new Date(r.redeemed_at).toLocaleString() : '-'}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function loadAuditLogs() {
    const { data, error } = await supabaseClient.rpc('admin_get_audit_logs', { p_limit: 100 });
    const tbody = document.getElementById('audit-table-body');
    tbody.innerHTML = '';
    if (error || !data) {
        tbody.innerHTML = `<tr><td colspan="5">Error loading audit logs</td></tr>`;
        return;
    }
    data.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${new Date(log.created_at).toLocaleString()}</td>
            <td>${log.admin_email || log.admin_id || 'System'}</td>
            <td><code>${log.action}</code></td>
            <td><small>${log.target_email || log.target_id || '-'}</small></td>
            <td><pre style="font-size:11px;background:none;color:var(--text-muted);">${JSON.stringify(log.details)}</pre></td>
        `;
        tbody.appendChild(tr);
    });
}

function openModal(title, desc, confirmCallback) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-desc').textContent = desc;
    currentModalAction = confirmCallback;
    document.getElementById('modal-backdrop').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal-backdrop').classList.add('hidden');
    currentModalAction = null;
}
