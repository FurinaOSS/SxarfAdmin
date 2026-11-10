// ============================================================================
// Sxarf AI Admin Console - Frontend Application Logic
// ============================================================================

const SUPABASE_URL = 'https://toduyybsfaxgidehogbe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZHV5eWJzZmF4Z2lkZWhvZ2JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxMzY5NzIsImV4cCI6MjEwOTcxMjk3Mn0.b7s-vQrNlsmIEMtZHV2krbql46jjaWGAGdREsqOnYz8';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit'
    }
});

// ---------------------------------------------------------------- state
let currentUser = null;
let currentModalAction = null;
let plans = [];               // [{plan, rank, display_name}] from plan_definitions
let verifying = false;        // prevents double admin checks
let verifiedUserId = null;

const $ = (id) => document.getElementById(id);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(v, withTime = false) {
    if (!v) return '-';
    const d = new Date(v);
    return withTime ? d.toLocaleString() : d.toLocaleDateString();
}

function errMsg(error) {
    return (error && (error.message || error.details)) || 'Unknown error';
}

// ---------------------------------------------------------------- boot
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupEventListeners();

    // Single source of truth: the auth listener. It fires INITIAL_SESSION on load
    // (also after returning from Google with the token in the URL hash).
    // NOTE: never await supabase calls directly inside this callback (can deadlock) -> setTimeout.
    sb.auth.onAuthStateChange((event, session) => {
        setTimeout(() => {
            if (session) handleSuccessfulAuth(session);
            else { verifiedUserId = null; showAuthView(); }
        }, 0);
    });
});

function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab(item.getAttribute('data-tab'));
        });
    });
}

function switchTab(tabName) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === tabName));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === `tab-${tabName}`));
    loadTabData(tabName);
}

function showAuthView() {
    $('auth-view').classList.remove('hidden');
    $('app-view').classList.add('hidden');
}

function showAuthError(msg) {
    $('auth-error').textContent = msg;
    $('auth-error').classList.remove('hidden');
}

async function handleSuccessfulAuth(session) {
    // Token refreshes re-fire the listener; don't re-verify the same user.
    if (verifying || (verifiedUserId === session.user.id && !$('app-view').classList.contains('hidden'))) return;
    verifying = true;
    currentUser = session.user;
    $('user-email').textContent = currentUser.email || '';

    try {
        const { error } = await sb.rpc('admin_get_overview_stats');
        if (error) {
            // 42501 = our assert_admin() rejection -> genuinely not an admin
            if (error.code === '42501') {
                showAuthError(`Access denied: ${currentUser.email} is not an administrator.`);
                await sb.auth.signOut();
                return;
            }
            // Anything else (function missing, network...) is a setup problem, not "not admin"
            showAuthError(`Could not verify admin access: ${errMsg(error)}`);
            showAuthView();
            return;
        }

        verifiedUserId = currentUser.id;
        $('auth-error').classList.add('hidden');
        $('auth-view').classList.add('hidden');
        $('app-view').classList.remove('hidden');
        await loadPlans();
        switchTab('overview');
    } finally {
        verifying = false;
    }
}

// ---------------------------------------------------------------- plans
async function loadPlans() {
    const { data, error } = await sb.rpc('admin_list_plans');
    if (error) { console.error('admin_list_plans failed', error); plans = []; alert('Could not load plans: ' + errMsg(error)); }
    else plans = data || [];

    const paid = plans.filter(p => p.rank > 0);
    $('gc-plan').innerHTML = paid.map(p => `<option value="${esc(p.plan)}">${esc(p.display_name || p.plan)}</option>`).join('');
}

function paidPlanNames() {
    return plans.filter(p => p.rank > 0).map(p => p.plan);
}

// ---------------------------------------------------------------- resolving a user
async function resolveUserId(input) {
    const v = (input || '').trim();
    if (!v) return null;
    if (UUID_RE.test(v)) return v;
    const { data, error } = await sb.rpc('admin_search_accounts', { p_query: v, p_limit: 5 });
    if (error) { alert('Lookup failed: ' + errMsg(error)); return null; }
    const exact = (data || []).filter(a => (a.email || '').toLowerCase() === v.toLowerCase());
    if (exact.length === 1) return exact[0].id;
    if ((data || []).length === 1) return data[0].id;
    alert((data || []).length ? 'Several accounts match; use the exact email or UUID.' : 'No account found for "' + v + '".');
    return null;
}

// ---------------------------------------------------------------- events
function setupEventListeners() {
    $('google-login-btn').addEventListener('click', async () => {
        $('auth-error').classList.add('hidden');
        const { error } = await sb.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin + window.location.pathname }
        });
        if (error) showAuthError(error.message);
    });

    $('logout-btn').addEventListener('click', async () => { await sb.auth.signOut(); });

    // Accounts
    $('account-search-btn').addEventListener('click', () => loadAccounts($('account-search-input').value.trim()));
    $('account-search-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loadAccounts($('account-search-input').value.trim());
    });
    $('accounts-table-body').addEventListener('click', onAccountAction);

    // Capabilities
    $('cap-submit-btn').addEventListener('click', async () => {
        const userId = await resolveUserId($('cap-user-input').value);
        const caps = $('cap-list-input').value.split(',').map(s => s.trim()).filter(Boolean);
        if (!userId || !caps.length) return alert('Enter a user (UUID or email) and at least one capability.');
        const { error } = await sb.rpc('admin_give_limited', { p_user_id: userId, p_capabilities: caps });
        if (error) return alert('Error: ' + errMsg(error));
        alert('Capabilities granted.');
        $('cap-user-input').value = '';
        $('cap-list-input').value = '';
    });

    // Gift cards
    $('gc-generate-btn').addEventListener('click', generateGiftCards);
    $('gc-refresh-btn').addEventListener('click', loadGiftCards);
    $('gc-table-body').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-revoke]');
        if (b) revokeGiftCard(b.dataset.revoke);
    });

    // Disclaimers
    $('disclaimer-send-one').addEventListener('click', async () => {
        const targetId = await resolveUserId($('disclaimer-target').value);
        const message = $('disclaimer-message').value.trim();
        if (!targetId || !message) return alert('A target user (UUID or email) and a message are required.');
        const { error } = await sb.rpc('admin_send_disclaimer_to', { p_user_id: targetId, p_message: message });
        if (error) return alert('Error: ' + errMsg(error));
        alert('Disclaimer sent.');
        $('disclaimer-message').value = '';
    });

    $('disclaimer-send-all').addEventListener('click', () => {
        const message = $('disclaimer-message').value.trim();
        if (!message) return alert('Message content is required.');
        openModal('Broadcast to all accounts', 'This sends the notice to every account. Continue?', async () => {
            const { error } = await sb.rpc('admin_send_disclaimer_to_all_accounts', { p_message: message });
            if (error) return alert('Error: ' + errMsg(error));
            alert('Broadcast sent.');
            $('disclaimer-message').value = '';
        });
    });

    // Public access
    $('public-shutdown-btn').addEventListener('click', () => {
        const msg = $('public-shutdown-msg').value.trim() || null;
        openModal('Shut down public access', 'Disable access to Sxarf AI for all users?', async () => {
            const { error } = await sb.rpc('admin_shut_down_public_access', { p_message: msg });
            if (error) return alert('Error: ' + errMsg(error));
            alert('Public access shut down.');
            loadPublicAccessState();
        });
    });

    $('public-restore-btn').addEventListener('click', async () => {
        const { error } = await sb.rpc('admin_start_public_access');
        if (error) return alert('Error: ' + errMsg(error));
        alert('Public access restored.');
        loadPublicAccessState();
    });

    // Settings
    $('test-connection-btn').addEventListener('click', async () => {
        const { data: { session } } = await sb.auth.getSession();
        const { data, error } = await sb.rpc('admin_get_overview_stats');
        alert(
            `Session: ${session ? 'signed in as ' + session.user.email : 'none'}\n` +
            `Admin RPC: ${error ? 'FAILED - ' + errMsg(error) : 'OK'}\n` +
            `Plans loaded: ${plans.length ? plans.map(p => p.plan).join(', ') : 'none (run admin_fix.sql)'}`
        );
    });

    // Modal
    $('modal-cancel-btn').addEventListener('click', closeModal);
    $('modal-confirm-btn').addEventListener('click', async () => {
        const action = currentModalAction;
        closeModal();
        if (action) await action();
    });
}

// ---------------------------------------------------------------- tabs
async function loadTabData(tabName) {
    switch (tabName) {
        case 'overview':     return loadOverviewStats();
        case 'accounts':     return loadAccounts($('account-search-input').value.trim());
        case 'giftcards':    return loadGiftCards();
        case 'publicaccess': return loadPublicAccessState();
        case 'redemptions':  return loadRedemptions();
        case 'auditlog':     return loadAuditLogs();
        case 'settings':
            $('config-url').value = SUPABASE_URL;
            $('config-key').value = SUPABASE_ANON_KEY;
    }
}

async function loadOverviewStats() {
    const { data, error } = await sb.rpc('admin_get_overview_stats');
    if (error || !data) { console.error('Overview stats failed:', error); return; }
    $('stat-total-accounts').textContent = data.total_accounts ?? 0;
    $('stat-active-subs').textContent = data.active_subscriptions ?? 0;
    $('stat-expired-subs').textContent = data.expired_subscriptions ?? 0;
    $('stat-suspended').textContent = data.suspended_accounts ?? 0;
    $('stat-terminated').textContent = data.terminated_accounts ?? 0;
    $('stat-gc-gen').textContent = data.gift_cards_generated ?? 0;
}

// ---------------------------------------------------------------- accounts
async function loadAccounts(query = '') {
    const tbody = $('accounts-table-body');
    tbody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
    const { data, error } = await sb.rpc('admin_search_accounts', { p_query: query, p_limit: 100 });
    if (error || !data) {
        tbody.innerHTML = `<tr><td colspan="5">Error loading accounts: ${esc(errMsg(error))}</td></tr>`;
        return;
    }
    if (!data.length) { tbody.innerHTML = '<tr><td colspan="5">No accounts found.</td></tr>'; return; }

    tbody.innerHTML = '';
    data.forEach(acc => {
        let badge = '<span class="badge badge-active">Active</span>';
        if (acc.is_terminated) badge = '<span class="badge badge-terminated">Terminated</span>';
        else if (acc.is_suspended) badge = '<span class="badge badge-suspended">Suspended</span>';

        const planLabel = acc.plan_ended ? `Free <small>(${esc(acc.plan)} ended)</small>` : esc(acc.plan || 'Free');
        const id = esc(acc.id);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${esc(acc.email) || 'No email'}</strong><br><small style="color:var(--text-muted);font-family:var(--font-mono);">${id}</small></td>
            <td><code>${planLabel}</code></td>
            <td>${acc.plan_expires_at ? esc(fmtDate(acc.plan_expires_at)) : (acc.plan && acc.plan !== 'Free' ? 'Never' : '-')}</td>
            <td>${badge}</td>
            <td>
                <button class="btn btn-secondary" data-action="upgrade" data-id="${id}" style="padding:4px 8px;font-size:11px;">Upgrade</button>
                <button class="btn btn-secondary" data-action="downgrade" data-id="${id}" style="padding:4px 8px;font-size:11px;">Downgrade</button>
                <button class="btn btn-secondary" data-action="revoke" data-id="${id}" style="padding:4px 8px;font-size:11px;">Revoke</button>
                ${acc.is_suspended
                    ? `<button class="btn btn-success" data-action="unsuspend" data-id="${id}" style="padding:4px 8px;font-size:11px;">Unsuspend</button>`
                    : `<button class="btn btn-secondary" data-action="suspend" data-id="${id}" style="padding:4px 8px;font-size:11px;">Suspend</button>`}
                <button class="btn btn-danger" data-action="terminate" data-id="${id}" style="padding:4px 8px;font-size:11px;">Terminate</button>
            </td>`;
        tbody.appendChild(tr);
    });
}

async function runAccountRpc(fn, args, okMsg) {
    const { error } = await sb.rpc(fn, args);
    if (error) return alert('Error: ' + errMsg(error));
    alert(okMsg);
    loadAccounts($('account-search-input').value.trim());
}

function onAccountAction(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const paid = paidPlanNames();

    switch (btn.dataset.action) {
        case 'upgrade': {
            const plan = prompt(`Plan to give (${paid.join(', ')}):`, paid[0] || '');
            if (!plan) return;
            const months = prompt('Duration in months (1, 3, 12). Leave blank for permanent:', '1');
            if (months === null) return;
            let expires = null;
            if (months.trim() !== '') {
                const m = parseInt(months, 10);
                if (!m || m < 1) return alert('Invalid number of months.');
                const d = new Date(); d.setMonth(d.getMonth() + m);
                expires = d.toISOString();
            }
            return runAccountRpc('admin_upgrade_account', { p_user_id: id, p_plan: plan.trim(), p_expires_at: expires }, 'Plan updated.');
        }
        case 'downgrade': {
            const names = plans.map(p => p.plan);
            const plan = prompt(`Set plan to (${names.join(', ')}):`, names[0] || 'Free');
            if (!plan) return;
            return runAccountRpc('admin_downgrade_account', { p_user_id: id, p_plan: plan.trim() }, 'Plan changed.');
        }
        case 'revoke':
            if (!confirm('Reset this account to Free and remove extra capabilities?')) return;
            return runAccountRpc('admin_revoke_account', { p_user_id: id }, 'Account reset to Free.');
        case 'suspend': {
            const reason = prompt('Suspension reason:', 'Administrative suspension');
            if (reason === null) return;
            return runAccountRpc('admin_suspend_account', { p_user_id: id, p_reason: reason }, 'Account suspended.');
        }
        case 'unsuspend':
            return runAccountRpc('admin_unsuspend_account', { p_user_id: id }, 'Account unsuspended.');
        case 'terminate': {
            const reason = prompt('PERMANENT termination reason:', 'Violation of terms');
            if (!reason) return;
            if (!confirm('Terminate this account permanently?')) return;
            return runAccountRpc('admin_terminate_account', { p_user_id: id, p_reason: reason }, 'Account terminated.');
        }
    }
}

// ---------------------------------------------------------------- gift cards
async function generateGiftCards() {
    const plan = $('gc-plan').value;
    const duration = $('gc-duration').value;
    const count = Math.min(Math.max(parseInt($('gc-count').value, 10) || 1, 1), 100);
    const note = $('gc-note').value.trim() || null;
    if (!plan) return alert('No paid plans loaded. Run admin_fix.sql, then reload.');

    const { data, error } = await sb.rpc('admin_generate_gift_cards_logged', {
        p_plan: plan, p_duration: duration, p_count: count, p_note: note
    });
    if (error) return alert('Error generating gift cards: ' + errMsg(error));

    $('gc-results-container').classList.remove('hidden');
    $('gc-generated-output').value = (data || []).map(r => r.code).join('\n');
    loadGiftCards();
}

async function loadGiftCards() {
    const tbody = $('gc-table-body');
    tbody.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';
    const { data, error } = await sb.rpc('admin_list_gift_cards', { p_status: null, p_limit: 200 });
    if (error || !data) { tbody.innerHTML = `<tr><td colspan="7">Error: ${esc(errMsg(error))}</td></tr>`; return; }
    if (!data.length) { tbody.innerHTML = '<tr><td colspan="7">No gift cards yet.</td></tr>'; return; }
    tbody.innerHTML = data.map(g => `
        <tr>
            <td><code>...${esc(g.code_hint)}</code></td>
            <td>${esc(g.reward_plan || '-')}</td>
            <td>${durationLabel(g.duration_months)}</td>
            <td>${esc(g.status)}</td>
            <td>${esc(g.note || '-')}</td>
            <td>${esc(g.redeemed_by_email || '-')}</td>
            <td>${g.status === 'unused' ? `<button class="btn btn-secondary" data-revoke="${esc(g.id)}">Revoke</button>` : ''}</td>
        </tr>`).join('');
}

async function revokeGiftCard(id) {
    if (!confirm('Revoke this unused card? This cannot be undone.')) return;
    const { data, error } = await sb.rpc('admin_revoke_gift_card', { p_id: id });
    if (error) return alert('Error: ' + errMsg(error));
    if (data && data.ok === false) return alert('Could not revoke: ' + (data.error || 'unknown'));
    loadGiftCards();
}

function durationLabel(m) {
    if (m === null || m === undefined) return 'Permanent';
    return m === 12 ? '1 year' : `${m} month${m > 1 ? 's' : ''}`;
}

// ---------------------------------------------------------------- public access
async function loadPublicAccessState() {
    const { data, error } = await sb.rpc('admin_get_overview_stats');
    if (error || !data) return;
    const pa = data.public_access || { enabled: true };
    const badge = $('public-access-status-badge');
    if (pa.enabled) {
        badge.textContent = 'ONLINE (Public Access Enabled)';
        badge.className = 'badge badge-active';
    } else {
        badge.textContent = 'SHUT DOWN: ' + (pa.message || 'Maintenance mode');
        badge.className = 'badge badge-suspended';
    }
}

// ---------------------------------------------------------------- redemptions / audit
async function loadRedemptions() {
    const tbody = $('redemptions-table-body');
    tbody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
    const { data, error } = await sb.rpc('admin_redemption_history', { p_limit: 200 });
    if (error || !data) { tbody.innerHTML = `<tr><td colspan="6">Error: ${esc(errMsg(error))}</td></tr>`; return; }
    if (!data.length) { tbody.innerHTML = '<tr><td colspan="6">No redemptions yet.</td></tr>'; return; }
    tbody.innerHTML = data.map(r => `
        <tr>
            <td><code>...${esc(r.code_hint)}</code></td>
            <td>${esc(r.reward_plan || '-')}</td>
            <td>${durationLabel(r.duration_months)}</td>
            <td>${esc(r.user_email || '-')}</td>
            <td>${esc(r.plan_before || '-')} &rarr; ${esc(r.plan_after || '-')}</td>
            <td>${esc(fmtDate(r.redeemed_at, true))}</td>
        </tr>`).join('');
}

async function loadAuditLogs() {
    const tbody = $('audit-table-body');
    tbody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
    const { data, error } = await sb.rpc('admin_get_audit_logs', { p_limit: 200 });
    if (error || !data) { tbody.innerHTML = `<tr><td colspan="5">Error: ${esc(errMsg(error))}</td></tr>`; return; }
    if (!data.length) { tbody.innerHTML = '<tr><td colspan="5">No audit entries yet.</td></tr>'; return; }
    tbody.innerHTML = data.map(log => `
        <tr>
            <td>${esc(fmtDate(log.created_at, true))}</td>
            <td>${esc(log.admin_email || log.admin_id || 'System')}</td>
            <td><code>${esc(log.action)}</code></td>
            <td><small>${esc(log.target_email || log.target_id || '-')}</small></td>
            <td><pre style="font-size:11px;background:none;color:var(--text-muted);white-space:pre-wrap;">${esc(JSON.stringify(log.details))}</pre></td>
        </tr>`).join('');
}

// ---------------------------------------------------------------- modal
function openModal(title, desc, confirmCallback) {
    $('modal-title').textContent = title;
    $('modal-desc').textContent = desc;
    currentModalAction = confirmCallback;
    $('modal-backdrop').classList.remove('hidden');
}

function closeModal() {
    $('modal-backdrop').classList.add('hidden');
    currentModalAction = null;
}
