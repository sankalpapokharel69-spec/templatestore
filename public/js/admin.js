/* ============================================================
   WebCraft Studio — admin panel
   Guarded by role=admin; renders sidebar/topbar + page modules
   ============================================================ */
'use strict';

const ADMIN_TITLES = {
  'admin-dashboard': 'Dashboard', 'admin-templates': 'Templates',
  'admin-orders': 'Orders', 'admin-customers': 'Customers',
  'admin-inbox': 'Inbox', 'admin-categories': 'Categories',
};
const ORDER_STATUSES_FE = ['Pending', 'Paid', 'Rejected', 'Completed'];
const adminSkeleton = `<div class="skeleton" style="height:200px;border-radius:14px"></div>`;

/* ---------------- chrome ---------------- */
function renderAdminChrome(user) {
  const page = document.body.dataset.page;
  const links = [
    ['admin-dashboard', '📊', 'Dashboard', 'admin/index.html'],
    ['admin-templates', '🎨', 'Templates', 'admin/templates.html'],
    ['admin-orders', '📦', 'Orders', 'admin/orders.html'],
    ['admin-customers', '👥', 'Customers', 'admin/customers.html'],
    ['admin-inbox', '✉️', 'Inbox', 'admin/inbox.html'],
    ['admin-categories', '🏷️', 'Categories', 'admin/categories.html'],
  ];
  $('#admin-sidebar').innerHTML = `
    <a class="brand" href="/index.html">${LOGO}<span>WebCraft<span class="brand-accent">Studio</span></span></a>
    <span class="admin-tag">Admin Panel</span>
    ${links.map(([key, ico, label, href]) => `
      <a class="admin-nav-link ${page === key ? 'active' : ''}" href="${href}">
        <span aria-hidden="true">${ico}</span>${label}
        ${key === 'admin-inbox' ? '<span class="badge badge-primary" id="inbox-badge" hidden></span>' : ''}
      </a>`).join('')}
    <a class="admin-nav-link" href="/index.html"><span aria-hidden="true">🌐</span>View Store</a>`;
  $('#admin-topbar').innerHTML = `
    <h1 class="admin-title">${ADMIN_TITLES[page] || 'Admin'}</h1>
    <div class="admin-user">
      <button class="icon-btn theme-toggle" aria-label="Toggle dark mode" title="Toggle theme">${MOON}${SUN}</button>
      <span class="admin-who">${esc(user.name)}</span>
      <button class="btn btn-ghost btn-sm" id="admin-logout">Log out</button>
    </div>`;
  $('.theme-toggle').addEventListener('click', toggleTheme);
  $('#admin-logout').addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    location.href = '/login.html';
  });
  api('/admin/stats').then((s) => {
    const b = $('#inbox-badge');
    if (b && s.unread > 0) { b.textContent = s.unread; b.hidden = false; }
  }).catch(() => {});
}

const statCard = (label, value) => `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`;

/* ---------------- DASHBOARD ---------------- */
async function initDashboard() {
  const c = $('#admin-content');
  c.innerHTML = adminSkeleton;
  const [s, { orders }] = await Promise.all([api('/admin/stats'), api('/admin/orders')]);
  c.innerHTML = `
    <div class="stat-grid">
      ${statCard('Total Sales', money(s.sales))}
      ${statCard('Orders', s.orders)}
      ${statCard('Pending Orders', s.pending)}
      ${statCard('Customers', s.users)}
      ${statCard('Unread Messages', s.unread)}
      ${statCard('Templates', s.templates)}
    </div>
    <div class="admin-head"><h2>Recent Orders</h2><a class="btn btn-ghost btn-sm" href="orders.html">View all</a></div>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
      <tbody>${orders.slice(0, 8).map((o) => `
        <tr>
          <td><strong>#${o.id}</strong></td>
          <td>${fmtDate(o.created_at)}</td>
          <td>${esc(o.customer_name)}<br><span class="muted small">${esc(o.customer_email)}</span></td>
          <td>${o.items.length}</td>
          <td><strong>${money(o.total)}</strong></td>
          <td><span class="badge badge-${o.status.toLowerCase()}">${o.status}</span></td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No orders yet.</td></tr>'}
      </tbody>
    </table></div>`;
}

/* ---------------- TEMPLATES MANAGER ---------------- */
let ADMIN_CATS = [];
async function initAdminTemplates() {
  const c = $('#admin-content');
  c.innerHTML = `
    <div class="admin-head">
      <p class="muted">Manage your catalog — screenshots and ZIPs are uploaded to R2.</p>
      <button class="btn btn-primary" id="add-tpl">+ Add Template</button>
    </div>
    <div id="tpl-table"></div><div id="tpl-modal-root"></div>`;
  $('#add-tpl').addEventListener('click', () => openTplModal(null));
  try { ADMIN_CATS = (await api('/categories')).categories; } catch {}
  await loadTplTable();
}

async function loadTplTable() {
  const box = $('#tpl-table');
  box.innerHTML = adminSkeleton;
  const { items } = await api('/admin/templates');
  box.innerHTML = items.length ? `
    <div class="table-wrap"><table>
      <thead><tr><th>Preview</th><th>Title</th><th>Category</th><th>Price</th><th>Pages</th><th>Featured</th><th>Files</th><th>Actions</th></tr></thead>
      <tbody>${items.map((t) => `
        <tr>
          <td>${t.cover ? `<img class="admin-thumb" src="${fileUrl('/api/files/' + t.cover)}" alt="">` : '<div class="admin-thumb ph-tile"></div>'}</td>
          <td><strong>${esc(t.title)}</strong><br><span class="muted small">/${esc(t.slug)}</span></td>
          <td>${esc(t.category_name)}</td>
          <td><strong>${money(t.price)}</strong></td>
          <td>${t.pages_count}</td>
          <td><button class="star-btn ${t.featured ? 'on' : ''}" data-feat="${t.id}" data-cur="${t.featured}" title="Toggle featured">${t.featured ? '★' : '☆'}</button></td>
          <td>${t.zip_key ? 'ZIP ✓' : 'ZIP ✗'} · ${t.shots} img</td>
          <td class="admin-actions">
            <button class="btn btn-ghost btn-sm" data-edit="${t.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-del="${t.id}" data-title="${esc(t.title)}">Delete</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`
    : `<div class="empty-state"><h3>No templates yet</h3><p>Click "Add Template" to create your first product.</p></div>`;
  $$('[data-feat]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('/admin/templates/' + b.dataset.feat, { method: 'PUT', body: { featured: b.dataset.cur !== '1' } });
      toast('Featured status updated.', 'success');
      loadTplTable();
    } catch (e) { toast(e.message, 'error'); }
  }));
  $$('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
    const { items } = await api('/admin/templates');
    openTplModal(items.find((t) => t.id === +b.dataset.edit));
  }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Delete "${b.dataset.title}"? This also removes its files. This cannot be undone.`)) return;
    try { await api('/admin/templates/' + b.dataset.del, { method: 'DELETE' }); toast('Template deleted.', 'success'); loadTplTable(); }
    catch (e) { toast(e.message, 'error'); }
  }));
}

function openTplModal(t) {
  const root = $('#tpl-modal-root');
  root.innerHTML = `
  <div class="modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">
      <div class="modal-head"><h2 id="m-title">${t ? 'Edit Template' : 'Add Template'}</h2><button class="icon-btn" id="m-close" aria-label="Close">✕</button></div>
      <form id="tpl-form">
        <div class="form-row">
          <div class="field"><label for="t-title">Title</label><input id="t-title" name="title" required minlength="3" maxlength="120" value="${t ? esc(t.title) : ''}"></div>
          <div class="field"><label for="t-cat">Category</label><select id="t-cat" name="category_id">
            ${ADMIN_CATS.map((cat) => `<option value="${cat.id}" ${t && t.category_id === cat.id ? 'selected' : ''}>${esc(cat.name)}</option>`).join('')}
          </select></div>
        </div>
        <div class="form-row">
          <div class="field"><label for="t-price">Price (USD)</label><input id="t-price" name="price" type="number" step="0.01" min="0" required value="${t ? esc(t.price) : ''}"></div>
          <div class="field"><label for="t-pages">Pages count</label><input id="t-pages" name="pages_count" type="number" min="1" max="200" required value="${t ? t.pages_count : '5'}"></div>
        </div>
        <div class="field"><label for="t-demo">Demo URL (optional)</label><input id="t-demo" name="demo_url" type="url" placeholder="https://your-demo.example.com" value="${t ? esc(t.demo_url) : ''}"></div>
        <div class="field"><label for="t-desc">Description</label><textarea id="t-desc" name="description" rows="4" required minlength="10">${t ? esc(t.description) : ''}</textarea></div>
        <div class="field"><label for="t-feat-list">Features (one per line)</label><textarea id="t-feat-list" name="features" rows="4" required>${t ? esc(t.features) : ''}</textarea></div>
        <div class="form-row">
          <div class="field"><label for="t-shots">Screenshots (PNG/JPG/WEBP${t ? ' — leave empty to keep current' : ''})</label><input id="t-shots" name="screenshots" type="file" accept="image/png,image/jpeg,image/webp" multiple></div>
          <div class="field"><label for="t-zip">Template ZIP${t ? ' — leave empty to keep current' : ''}</label><input id="t-zip" name="zip" type="file" accept=".zip"></div>
        </div>
        <label class="check-row"><input type="checkbox" name="featured" ${t && t.featured ? 'checked' : ''}> Featured on homepage</label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="m-cancel">Cancel</button>
          <button class="btn btn-primary" type="submit">${t ? 'Save changes' : 'Create template'}</button>
        </div>
      </form>
    </div>
  </div>`;
  const close = () => { root.innerHTML = ''; };
  $('#m-close').addEventListener('click', close);
  $('#m-cancel').addEventListener('click', close);
  $('.modal-backdrop').addEventListener('click', (e) => { if (e.target.classList.contains('modal-backdrop')) close(); });
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  $('#tpl-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const fd = new FormData(e.target);
      if (t) await api('/admin/templates/' + t.id, { method: 'PUT', formData: fd });
      else await api('/admin/templates', { method: 'POST', formData: fd });
      toast(t ? 'Template updated.' : 'Template created.', 'success');
      close();
      loadTplTable();
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Save'; }
  });
}

/* ---------------- ORDERS MANAGER ---------------- */
async function initAdminOrders() {
  const c = $('#admin-content');
  c.innerHTML = `
    <div class="admin-head">
      <p class="muted">Verify payments and unlock customer downloads by marking orders as Paid.</p>
      <select id="o-filter" class="admin-select" aria-label="Filter by status">
        <option value="">All statuses</option>
        ${ORDER_STATUSES_FE.map((s) => `<option>${s}</option>`).join('')}
      </select>
    </div>
    <div id="orders-table"></div>`;
  $('#o-filter').addEventListener('change', loadOrders);
  async function loadOrders() {
    const box = $('#orders-table');
    box.innerHTML = adminSkeleton;
    const status = $('#o-filter').value;
    const { orders } = await api('/admin/orders' + (status ? '?status=' + encodeURIComponent(status) : ''));
    box.innerHTML = orders.length ? `
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Method</th><th>Proof</th><th>Status</th></tr></thead>
      <tbody>${orders.map((o) => `
        <tr>
          <td><strong>#${o.id}</strong></td>
          <td>${fmtDate(o.created_at)}</td>
          <td>${esc(o.customer_name)}<br><span class="muted small">${esc(o.customer_email)}</span></td>
          <td>${o.items.map((i) => esc(i.title)).join('<br>')}</td>
          <td><strong>${money(o.total)}</strong></td>
          <td>${o.payment_method}</td>
          <td>${o.proof_url ? `<button class="btn btn-ghost btn-sm" data-proof="${esc(o.proof_url)}">View</button>` : '<span class="muted small">—</span>'}</td>
          <td>
            <select class="admin-select status-select" data-order="${o.id}" aria-label="Order status">
              ${ORDER_STATUSES_FE.map((s) => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`
    : `<div class="empty-state"><h3>No orders found</h3></div>`;
    $$('[data-proof]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const res = await fetch(fileUrl(b.dataset.proof), { credentials: 'include' });
        if (!res.ok) throw new Error('Could not load proof.');
        window.open(URL.createObjectURL(await res.blob()), '_blank');
      } catch (e) { toast(e.message, 'error'); }
    }));
    $$('.status-select').forEach((sel) => sel.addEventListener('change', async () => {
      try {
        await api('/admin/orders/' + sel.dataset.order, { method: 'PATCH', body: { status: sel.value } });
        toast(`Order #${sel.dataset.order} marked ${sel.value}.`, 'success');
      } catch (e) { toast(e.message, 'error'); loadOrders(); }
    }));
  }
  loadOrders();
}

/* ---------------- CUSTOMERS ---------------- */
async function initCustomers() {
  const c = $('#admin-content');
  c.innerHTML = adminSkeleton;
  const { customers } = await api('/admin/customers');
  c.innerHTML = `
    <div class="admin-head"><p class="muted">Everyone who has registered on your store.</p></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Orders</th><th>Total spent</th></tr></thead>
      <tbody>${customers.map((u) => `
        <tr>
          <td><div class="person-cell"><span class="avatar">${esc(initials(u.name))}</span><strong>${esc(u.name)}</strong></div></td>
          <td>${esc(u.email)}</td>
          <td>${fmtDate(u.created_at)}</td>
          <td>${u.orders}</td>
          <td><strong>${money(u.spent)}</strong></td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">No customers yet.</td></tr>'}
      </tbody>
    </table></div>`;
}

/* ---------------- INBOX ---------------- */
async function initInbox() {
  const c = $('#admin-content');
  c.innerHTML = `
    <div class="admin-head">
      <div class="tabs" id="inbox-tabs">
        <button class="tab-btn active" data-filter="all">All</button>
        <button class="tab-btn" data-filter="contact">Contact</button>
        <button class="tab-btn" data-filter="support">Support</button>
        <button class="tab-btn" data-filter="unread">Unread</button>
      </div>
    </div>
    <div id="msg-list"></div>`;
  let filter = 'all';
  $$('#inbox-tabs .tab-btn').forEach((b) => b.addEventListener('click', () => {
    $$('#inbox-tabs .tab-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    filter = b.dataset.filter;
    loadMsgs();
  }));
  async function loadMsgs() {
    const box = $('#msg-list');
    box.innerHTML = adminSkeleton;
    let url = '/admin/messages';
    if (filter === 'contact' || filter === 'support') url += '?type=' + filter;
    else if (filter === 'unread') url += '?unread=1';
    const { messages } = await api(url);
    box.innerHTML = messages.length ? messages.map((m) => `
      <div class="inbox-card ${m.is_read ? '' : 'unread'}">
        <div class="inbox-head">
          <div class="inbox-who">
            <strong>${esc(m.name)}</strong>
            <span class="muted">&lt;${esc(m.email)}&gt;</span>
            <span class="badge badge-primary">${m.type}</span>
            ${m.is_read ? '' : '<span class="unread-dot" title="Unread"></span>'}
          </div>
          <span class="muted small">${fmtDate(m.created_at)}</span>
        </div>
        ${m.subject ? `<strong class="inbox-subject">${esc(m.subject)}</strong>` : ''}
        <p class="inbox-msg">${esc(m.message)}</p>
        <div class="inbox-actions">
          <button class="btn btn-ghost btn-sm" data-read="${m.id}" data-cur="${m.is_read}">${m.is_read ? 'Mark unread' : 'Mark read'}</button>
          <a class="btn btn-ghost btn-sm" href="mailto:${esc(m.email)}?subject=${encodeURIComponent('Re: ' + (m.subject || 'your message'))}">Reply</a>
          <button class="btn btn-danger btn-sm" data-mdel="${m.id}">Delete</button>
        </div>
      </div>`).join('')
      : `<div class="empty-state"><h3>Inbox zero 🎉</h3><p>No messages in this view.</p></div>`;
    $$('[data-read]').forEach((b) => b.addEventListener('click', async () => {
      try { await api('/admin/messages/' + b.dataset.read, { method: 'PATCH', body: { is_read: b.dataset.cur !== '1' } }); loadMsgs(); }
      catch (e) { toast(e.message, 'error'); }
    }));
    $$('[data-mdel]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this message?')) return;
      try { await api('/admin/messages/' + b.dataset.mdel, { method: 'DELETE' }); toast('Message deleted.', 'success'); loadMsgs(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }
  loadMsgs();
}

/* ---------------- CATEGORIES ---------------- */
async function initCategories() {
  const c = $('#admin-content');
  c.innerHTML = `
    <div class="admin-head"><p class="muted">Categories power the storefront filters and navigation.</p></div>
    <form class="cat-add" id="cat-form">
      <input id="cat-name" placeholder="New category name" maxlength="40" required aria-label="New category name">
      <button class="btn btn-primary btn-sm" type="submit">Add category</button>
    </form>
    <div id="cat-table"></div>`;
  $('#cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/admin/categories', { method: 'POST', body: { name: $('#cat-name').value.trim() } });
      toast('Category added.', 'success');
      $('#cat-name').value = '';
      loadCats();
    } catch (err) { toast(err.message, 'error'); }
  });
  async function loadCats() {
    const box = $('#cat-table');
    box.innerHTML = adminSkeleton;
    const { categories } = await api('/admin/categories');
    box.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Slug</th><th>Templates</th><th>Actions</th></tr></thead>
      <tbody>${categories.map((cat) => `
        <tr>
          <td class="cat-name-cell" data-id="${cat.id}">${esc(cat.name)}</td>
          <td class="muted">${esc(cat.slug)}</td>
          <td>${cat.count}</td>
          <td class="admin-actions">
            <button class="btn btn-ghost btn-sm" data-ren="${cat.id}" data-name="${esc(cat.name)}">Rename</button>
            <button class="btn btn-danger btn-sm" data-cdel="${cat.id}">Delete</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
    $$('[data-ren]').forEach((b) => b.addEventListener('click', () => {
      const cell = $(`.cat-name-cell[data-id="${b.dataset.ren}"]`);
      cell.innerHTML = `<input class="cat-rename" value="${esc(b.dataset.name)}" maxlength="40" aria-label="Category name">
        <button class="btn btn-primary btn-sm" data-save="${b.dataset.ren}">Save</button>`;
      $('[data-save]', cell).addEventListener('click', async () => {
        const name = $('.cat-rename', cell).value.trim();
        if (!name) return toast('Name cannot be empty.', 'error');
        try { await api('/admin/categories/' + b.dataset.ren, { method: 'PATCH', body: { name } }); toast('Category renamed.', 'success'); loadCats(); }
        catch (e) { toast(e.message, 'error'); }
      });
    }));
    $$('[data-cdel]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this category?')) return;
      try { await api('/admin/categories/' + b.dataset.cdel, { method: 'DELETE' }); toast('Category deleted.', 'success'); loadCats(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }
  loadCats();
}

/* ---------------- admin router ---------------- */
function onAdminReady() {
  const user = Auth.user;
  if (!user || user.role !== 'admin') {
    location.href = '/login.html?next=' + encodeURIComponent(location.pathname);
    return;
  }
  renderAdminChrome(user);
  const inits = {
    'admin-dashboard': initDashboard, 'admin-templates': initAdminTemplates,
    'admin-orders': initAdminOrders, 'admin-customers': initCustomers,
    'admin-inbox': initInbox, 'admin-categories': initCategories,
  };
  const fn = inits[document.body.dataset.page];
  if (fn) Promise.resolve(fn()).catch((err) => { console.error(err); toast(err.message || 'Something went wrong.', 'error'); });
}
if (window.__wcReady) onAdminReady();
else document.addEventListener('wc:ready', onAdminReady);