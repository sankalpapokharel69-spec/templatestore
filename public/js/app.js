/* ============================================================
   WebCraft Studio — visitor page controllers
   ============================================================ */
'use strict';

const CAT_ICONS = {
  restaurant: '🍽️', hotel: '🏨', salon: '💅', furniture: '🛋️', 'real-estate': '🏡',
  gym: '💪', photography: '📸', portfolio: '🎨', business: '💼',
};

function templateCard(t) {
  const cover = t.cover
    ? `<img src="${fileUrl('/api/files/' + t.cover)}" alt="${esc(t.title)} — template preview" loading="lazy">`
    : `<div class="ph-tile">${esc(t.title)}</div>`;
  return `
  <article class="t-card reveal">
    <a class="t-thumb" href="template.html?id=${t.id}" aria-label="View ${esc(t.title)}">
      ${cover}
      <span class="chip cat-chip">${esc(t.category_name)}</span>
      ${t.featured ? '<span class="chip feat-chip">★ Featured</span>' : ''}
    </a>
    <div class="t-body">
      <h3><a href="template.html?id=${t.id}">${esc(t.title)}</a></h3>
      <p class="t-meta">${t.pages_count} page${t.pages_count === 1 ? '' : 's'} · ${esc(t.category_name)}</p>
      <div class="t-foot">
        <span class="price">${money(t.price)}</span>
        <a class="btn btn-ghost btn-sm" href="template.html?id=${t.id}">View details</a>
      </div>
    </div>
  </article>`;
}

const skeletonCard = () => `
  <div class="t-card"><div class="t-thumb skeleton"></div>
  <div class="t-body"><div class="skeleton sk-line w60"></div><div class="skeleton sk-line w40"></div><div class="skeleton sk-line w30"></div></div></div>`;

function renderPagination(el, data, go) {
  if (!el) return;
  const { page, pages } = data;
  if (pages <= 1) { el.innerHTML = ''; return; }
  const start = Math.max(1, page - 2);
  const end = Math.min(pages, start + 4);
  let html = `<button class="page-btn" ${page === 1 ? 'disabled' : ''} data-p="${page - 1}" aria-label="Previous page">‹</button>`;
  for (let i = start; i <= end; i++) html += `<button class="page-btn ${i === page ? 'active' : ''}" data-p="${i}">${i}</button>`;
  html += `<button class="page-btn" ${page === pages ? 'disabled' : ''} data-p="${page + 1}" aria-label="Next page">›</button>`;
  el.innerHTML = html;
  $$('.page-btn', el).forEach((b) => b.addEventListener('click', () => {
    const p = +b.dataset.p;
    if (p >= 1 && p <= pages && p !== page) { window.scrollTo({ top: 0, behavior: 'smooth' }); go(p); }
  }));
}

/* ---------------- HOME ---------------- */
async function initHome() {
  const grid = $('#featured-grid');
  if (grid) {
    grid.innerHTML = skeletonCard().repeat(4);
    try {
      const { items } = await api('/templates?featured=1&limit=8');
      grid.innerHTML = items.length ? items.map(templateCard).join('')
        : `<p class="muted empty-state">No featured templates yet — check back soon!</p>`;
    } catch (e) { grid.innerHTML = `<p class="muted empty-state">${esc(e.message)}</p>`; }
    observeReveals();
  }
  const cgrid = $('#categories-grid');
  if (cgrid) {
    try {
      const { categories } = await api('/categories');
      cgrid.innerHTML = categories.map((c) => `
        <a class="cat-tile reveal" href="templates.html?category=${c.slug}">
          <span class="cat-ico" aria-hidden="true">${CAT_ICONS[c.slug] || '✨'}</span>
          <span class="cat-name">${esc(c.name)}</span>
          <span class="cat-count">${c.count} template${c.count === 1 ? '' : 's'}</span>
        </a>`).join('');
    } catch {}
    observeReveals();
  }
  const form = $('#hero-search-form');
  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#hero-search').value.trim();
    location.href = 'templates.html' + (q ? `?search=${encodeURIComponent(q)}` : '');
  });
}

/* ---------------- TEMPLATES LIST ---------------- */
async function initTemplates() {
  const params = new URLSearchParams(location.search);
  const state = {
    search: params.get('search') || '', category: params.get('category') || '',
    min: params.get('min') || '', max: params.get('max') || '',
    sort: params.get('sort') || 'newest', page: Math.max(1, parseInt(params.get('page')) || 1),
  };
  const catSel = $('#f-category');
  if (catSel) {
    catSel.innerHTML = '<option value="">All categories</option>';
    try {
      const { categories } = await api('/categories');
      catSel.innerHTML += categories.map((c) => `<option value="${c.slug}">${esc(c.name)}</option>`).join('');
    } catch {}
    catSel.value = state.category;
  }
  const searchEl = $('#f-search'), minEl = $('#f-min'), maxEl = $('#f-max'), sortEl = $('#f-sort');
  if (searchEl) searchEl.value = state.search;
  if (minEl) minEl.value = state.min;
  if (maxEl) maxEl.value = state.max;
  if (sortEl) sortEl.value = state.sort;

  const grid = $('#templates-grid'), pag = $('#pagination'), countEl = $('#result-count');
  async function load() {
    if (!grid) return;
    grid.innerHTML = skeletonCard().repeat(8);
    const q = new URLSearchParams();
    if (state.search) q.set('search', state.search);
    if (state.category) q.set('category', state.category);
    if (state.min) q.set('min', state.min);
    if (state.max) q.set('max', state.max);
    q.set('sort', state.sort); q.set('page', String(state.page)); q.set('limit', '12');
    history.replaceState(null, '', 'templates.html?' + q.toString());
    try {
      const data = await api('/templates?' + q.toString());
      if (countEl) countEl.textContent = `${data.total} template${data.total === 1 ? '' : 's'} found`;
      grid.innerHTML = data.items.length ? data.items.map(templateCard).join('') : `
        <div class="empty-state">
          <h3>No templates match your filters</h3>
          <p>Try clearing the filters or searching for something else.</p>
        </div>`;
      renderPagination(pag, data, (p) => { state.page = p; load(); });
      observeReveals();
    } catch (e) { grid.innerHTML = `<p class="muted empty-state">${esc(e.message)}</p>`; }
  }
  if (searchEl) searchEl.addEventListener('input', debounce(() => { state.search = searchEl.value.trim(); state.page = 1; load(); }, 350));
  if (catSel) catSel.addEventListener('change', () => { state.category = catSel.value; state.page = 1; load(); });
  if (minEl) minEl.addEventListener('input', debounce(() => { state.min = minEl.value; state.page = 1; load(); }, 450));
  if (maxEl) maxEl.addEventListener('input', debounce(() => { state.max = maxEl.value; state.page = 1; load(); }, 450));
  if (sortEl) sortEl.addEventListener('change', () => { state.sort = sortEl.value; state.page = 1; load(); });
  const clearBtn = $('#f-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    Object.assign(state, { search: '', category: '', min: '', max: '', sort: 'newest', page: 1 });
    if (searchEl) searchEl.value = '';
    if (catSel) catSel.value = '';
    if (minEl) minEl.value = '';
    if (maxEl) maxEl.value = '';
    if (sortEl) sortEl.value = 'newest';
    load();
  });
  load();
}

/* ---------------- TEMPLATE DETAIL ---------------- */
async function initTemplate() {
  const wrap = $('#template-detail');
  if (!wrap) return;
  const key = new URLSearchParams(location.search).get('id');
  if (!key) {
    wrap.innerHTML = `<div class="empty-state"><h3>Template not found</h3><a class="btn btn-primary" href="templates.html">Browse templates</a></div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="tpl-detail">
      <div><div class="gallery-main skeleton"></div><div class="gallery-thumbs">${'<div class="skeleton" style="width:96px;aspect-ratio:3/2"></div>'.repeat(3)}</div></div>
      <div><div class="skeleton sk-line w60" style="height:28px"></div><div class="skeleton sk-line w40"></div><div class="skeleton sk-line w100"></div><div class="skeleton sk-line w100"></div></div>
    </div>`;
  try {
    const { template: t, related } = await api('/templates/' + encodeURIComponent(key));
    document.title = `${t.title} — WebCraft Studio`;
    const crumb = $('#crumb');
    if (crumb) crumb.textContent = t.title;
    const shots = t.screenshots.length ? t.screenshots : [null];
    wrap.innerHTML = `
    <div class="tpl-detail">
      <div class="tpl-gallery">
        <div class="gallery-main">
          ${shots[0] ? `<img id="gallery-main" src="${fileUrl(shots[0])}" alt="${esc(t.title)} — main preview">` : `<div class="ph-tile">${esc(t.title)}</div>`}
        </div>
        ${shots.length > 1 ? `<div class="gallery-thumbs" id="gallery-thumbs">
          ${shots.map((s, i) => s ? `<button type="button" class="${i === 0 ? 'active' : ''}" data-src="${fileUrl(s)}" aria-label="Preview ${i + 1}"><img src="${fileUrl(s)}" alt="${esc(t.title)} preview ${i + 1}"></button>` : '').join('')}
        </div>` : ''}
      </div>
      <div class="tpl-info">
        <div class="chips-row">
          <span class="badge badge-cat">${esc(t.category_name)}</span>
          ${t.featured ? '<span class="badge badge-feat">★ Featured</span>' : ''}
        </div>
        <h1>${esc(t.title)}</h1>
        <p class="tpl-meta-row"><span class="stars" aria-label="Rated 4.9 out of 5">★★★★★</span> 4.9 · ${t.pages_count} pages · Added ${fmtDate(t.created_at)}</p>
        <p class="tpl-price">${money(t.price)} <span class="tpl-price-note">one-time payment</span></p>
        <p class="tpl-desc">${esc(t.description)}</p>
        <h3 class="tpl-h3">What's included</h3>
        <ul class="feature-list">
          ${t.features.map((f) => `<li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>${esc(f)}</li>`).join('')}
        </ul>
        <div class="tpl-actions">
          ${t.demo_url ? `<a class="btn btn-ghost btn-lg" href="${esc(t.demo_url)}" target="_blank" rel="noopener">▶ Live Demo</a>` : '<span class="badge badge-muted">Demo coming soon</span>'}
          <button class="btn btn-primary btn-lg" id="btn-add">Add to Cart</button>
          <button class="btn btn-accent btn-lg" id="btn-buy">Buy Now</button>
        </div>
        <div class="tpl-meta-cards">
          <div class="meta-card"><strong>${t.pages_count}</strong>Pages</div>
          <div class="meta-card"><strong>${esc(t.category_name)}</strong>Category</div>
          <div class="meta-card"><strong>ZIP</strong>Format</div>
          <div class="meta-card"><strong>Single site</strong>License</div>
        </div>
      </div>
    </div>`;
    $('#btn-add').addEventListener('click', () => addToCart(t.id));
    $('#btn-buy').addEventListener('click', () => {
      addToCart(t.id);
      location.href = Auth.user ? 'checkout.html' : 'login.html?next=checkout.html';
    });
        $$('#gallery-thumbs button').forEach((b) => b.addEventListener('click', () => {
      $('#gallery-main').src = b.dataset.src;
      $$('#gallery-thumbs button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    }));
    const rgrid = $('#related-grid');
    if (rgrid) {
      rgrid.innerHTML = related.length ? related.map(templateCard).join('')
        : `<p class="muted">No related templates yet.</p>`;
      observeReveals();
    }
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state"><h3>Template not found</h3><p>${esc(e.message)}</p><a class="btn btn-primary" href="templates.html">Browse templates</a></div>`;
  }
}

/* ---------------- CART ---------------- */
async function initCart() {
  const wrap = $('#cart-page');
  if (!wrap) return;
  async function render() {
    const ids = getCart();
    if (!ids.length) {
      wrap.innerHTML = `<div class="empty-state">
        <div class="empty-ico" aria-hidden="true">🛒</div>
        <h3>Your cart is empty</h3>
        <p>Browse our template library and find something you love.</p>
        <a class="btn btn-primary" href="templates.html">Browse templates</a>
      </div>`;
      return;
    }
    wrap.innerHTML = `<div class="skeleton" style="height:120px;border-radius:14px"></div><div class="skeleton" style="height:120px;border-radius:14px"></div>`;
    try {
      const { items } = await api('/templates?ids=' + ids.join(','));
      const byId = Object.fromEntries(items.map((t) => [t.id, t]));
      const rows = ids.map((id) => byId[id]).filter(Boolean);
      const total = rows.reduce((s, t) => s + t.price, 0);
      wrap.innerHTML = `
      <div class="cart-layout">
        <div>
          ${rows.map((t) => `
          <div class="cart-item">
            <a href="template.html?id=${t.id}">${t.cover ? `<img src="${fileUrl('/api/files/' + t.cover)}" alt="${esc(t.title)}">` : `<div class="ph-tile">${esc(t.title)}</div>`}</a>
            <div class="cart-item-info">
              <h3><a href="template.html?id=${t.id}">${esc(t.title)}</a></h3>
              <p class="muted">${esc(t.category_name)} · ${t.pages_count} pages</p>
              <button class="link-btn" data-remove="${t.id}">Remove</button>
            </div>
            <span class="price">${money(t.price)}</span>
          </div>`).join('')}
        </div>
        <aside class="summary-card">
          <h3>Order Summary</h3>
          <div class="summary-row"><span>${rows.length} template${rows.length === 1 ? '' : 's'}</span><span>${money(total)}</span></div>
          <div class="summary-row"><span>Instant delivery</span><span>After payment</span></div>
          <div class="summary-total"><span>Total</span><span>${money(total)}</span></div>
          <button class="btn btn-primary btn-lg btn-block" id="to-checkout">Proceed to Checkout</button>
          <a class="btn btn-ghost btn-block" href="templates.html">Continue shopping</a>
        </aside>
      </div>`;
      $$('[data-remove]').forEach((b) => b.addEventListener('click', () => { removeFromCart(+b.dataset.remove); render(); }));
      $('#to-checkout').addEventListener('click', () => {
        location.href = Auth.user ? 'checkout.html' : 'login.html?next=checkout.html';
      });
    } catch (e) { wrap.innerHTML = `<p class="muted empty-state">${esc(e.message)}</p>`; }
  }
  render();
}

/* ---------------- CHECKOUT ---------------- */
async function initCheckout() {
  const wrap = $('#checkout-page');
  if (!wrap) return;
  if (!Auth.user) { location.href = 'login.html?next=checkout.html'; return; }
  const ids = getCart();
  if (!ids.length) {
    wrap.innerHTML = `<div class="empty-state"><h3>Your cart is empty</h3><a class="btn btn-primary" href="templates.html">Browse templates</a></div>`;
    return;
  }
  wrap.innerHTML = `<div class="skeleton" style="height:300px;border-radius:16px"></div>`;
  try {
    const [{ items }, { methods }] = await Promise.all([
      api('/templates?ids=' + ids.join(',')),
      api('/payment-info'),
    ]);
    const byId = Object.fromEntries(items.map((t) => [t.id, t]));
    const rows = ids.map((id) => byId[id]).filter(Boolean);
    const total = rows.reduce((s, t) => s + t.price, 0);
    wrap.innerHTML = `
    <div class="cart-layout">
      <div>
        <div class="panel">
          <h3>Payment method</h3>
          <div class="pay-methods" id="pay-methods">
            ${Object.entries(methods).map(([key, m], i) => `
            <label class="pay-method ${i === 0 ? 'selected' : ''}">
              <input type="radio" name="pay" value="${key}" ${i === 0 ? 'checked' : ''}>
              <span><strong>${esc(m.label)}</strong><p>${esc(m.instructions)}</p></span>
            </label>`).join('')}
          </div>
          <div class="field">
            <label for="co-notes">Order notes (optional)</label>
            <textarea id="co-notes" rows="3" maxlength="500" placeholder="Anything we should know?"></textarea>
          </div>
          <button class="btn btn-primary btn-lg" id="place-order">Place Order — ${money(total)}</button>
          <p class="muted small">You will upload your payment proof on the next screen. Downloads unlock after we verify your payment.</p>
        </div>
      </div>
      <aside class="summary-card">
        <h3>Order Summary</h3>
        ${rows.map((t) => `<div class="summary-row"><span>${esc(t.title)}</span><span>${money(t.price)}</span></div>`).join('')}
        <div class="summary-total"><span>Total</span><span>${money(total)}</span></div>
      </aside>
    </div>`;
    $$('.pay-method').forEach((el) => el.addEventListener('click', () => {
      $$('.pay-method').forEach((x) => x.classList.remove('selected'));
      el.classList.add('selected');
      el.querySelector('input').checked = true;
    }));
    $('#place-order').addEventListener('click', async () => {
      const btn = $('#place-order');
      btn.disabled = true; btn.textContent = 'Placing order…';
      try {
        const method = $('input[name="pay"]:checked').value;
        const { order } = await api('/orders', {
          method: 'POST',
          body: { items: ids, paymentMethod: method, notes: $('#co-notes').value.trim() },
        });
        saveCart([]);
        await syncServerCart();
        toast('Order placed! Complete your payment next.', 'success');
        location.href = 'order-success.html?id=' + order.id;
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = `Place Order — ${money(total)}`; }
    });
  } catch (e) { wrap.innerHTML = `<p class="muted empty-state">${esc(e.message)}</p>`; }
}

/* ---------------- ORDER SUCCESS ---------------- */
async function initOrderSuccess() {
  const wrap = $('#order-page');
  if (!wrap) return;
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { location.href = 'index.html'; return; }
  wrap.innerHTML = `<div class="skeleton" style="height:300px;border-radius:16px"></div>`;
  try {
    const { order } = await api('/orders/' + encodeURIComponent(id));
    document.title = `Order #${order.id} — WebCraft Studio`;
    const paid = ['Paid', 'Completed'].includes(order.status);
    wrap.innerHTML = `
    <div class="order-success">
      <div class="success-banner reveal in">
        <div class="success-ico" aria-hidden="true">✓</div>
        <h1>Thank you for your order!</h1>
        <p>Order <strong>#${order.id}</strong> · ${fmtDate(order.created_at)} · <span class="badge badge-${order.status.toLowerCase()}">${order.status}</span></p>
      </div>
      <div class="order-grid">
        <div>
          <div class="panel">
            <h3>Items</h3>
            ${order.items.map((it) => `
            <div class="order-item-row">
              <div><strong>${esc(it.title)}</strong><br><span class="muted">${money(it.price)}</span></div>
              ${paid ? `<button class="btn btn-primary btn-sm" data-dl="${it.template_id}" data-name="${esc(it.title)}">⬇ Download ZIP</button>`
                     : `<span class="muted small">Unlocks after payment is verified</span>`}
            </div>`).join('')}
            <div class="summary-total"><span>Total</span><span>${money(order.total)}</span></div>
          </div>
          <div class="panel">
            <h3>What happens next?</h3>
            <ol class="steps">
              <li>Send <strong>${money(order.total)}</strong> using <strong>${esc(order.payment.label)}</strong> — see the instructions on the right.</li>
              <li>Upload your payment proof below. We verify payments within a few hours (Sun–Fri, 9am–6pm).</li>
              <li>Once your order is marked <strong>Paid</strong>, download buttons appear here and in <a href="account.html">My Account</a>.</li>
            </ol>
          </div>
        </div>
        <div>
          <div class="panel panel-accent">
            <h3>${esc(order.payment.label)} — payment instructions</h3>
            <p class="pay-instructions">${esc(order.payment.instructions)}</p>
          </div>
          <div class="panel">
            <h3>Payment proof</h3>
            ${order.proof_url
              ? `<p class="ok-note">✓ Proof uploaded — we're reviewing it now.</p>`
              : order.status === 'Pending' ? `
                <form id="proof-form">
                  <div class="field">
                    <label for="proof-file">Upload screenshot / receipt (PNG, JPG, WEBP or PDF, max 5 MB)</label>
                    <input type="file" id="proof-file" accept="image/png,image/jpeg,image/webp,application/pdf" required>
                  </div>
                  <button class="btn btn-primary" type="submit">Upload proof</button>
                </form>`
              : `<p class="muted">No proof needed for this order status.</p>`}
          </div>
        </div>
      </div>
    </div>`;
    $$('[data-dl]').forEach((b) => b.addEventListener('click', () =>
      downloadFile(`/download/${order.id}/${b.dataset.dl}`, `${b.dataset.name}.zip`).catch((e) => toast(e.message, 'error'))));
    const pf = $('#proof-form');
    if (pf) pf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = $('#proof-file').files[0];
      if (!f) return toast('Choose a file first.', 'error');
      const fd = new FormData(); fd.append('proof', f);
      const btn = pf.querySelector('button');
      btn.disabled = true; btn.textContent = 'Uploading…';
      try {
        await api(`/orders/${order.id}/proof`, { method: 'POST', formData: fd });
        toast('Proof uploaded! We will verify it shortly.', 'success');
        initOrderSuccess();
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Upload proof'; }
    });
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state"><h3>Order not found</h3><p>${esc(e.message)}</p><a class="btn btn-primary" href="account.html">My orders</a></div>`;
  }
}

/* ---------------- CONTACT & SUPPORT ---------------- */
function bindMessageForm(sel, path, okMsg) {
  const form = $(sel);
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const fd = new FormData(form);
      await api(path, { method: 'POST', body: Object.fromEntries(fd) });
      form.reset();
      toast(okMsg, 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Send Message'; }
  });
}
function initContact() { bindMessageForm('#contact-form', '/contact', 'Thanks! Your message has been sent — we usually reply within 24 hours.'); }
function initSupport() { bindMessageForm('#support-form', '/support', 'Ticket received! Our support team will get back to you soon.'); }

/* ---------------- AUTH PAGES ---------------- */
function initRegister() {
  const form = $('#register-form');
  if (!form) return;
  const next = new URLSearchParams(location.search).get('next') || 'index.html';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    if (fd.get('password') !== fd.get('confirm')) return toast('Passwords do not match.', 'error');
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Creating account…';
    try {
      await api('/auth/register', { method: 'POST', body: { name: fd.get('name'), email: fd.get('email'), password: fd.get('password') } });
      toast('Welcome to WebCraft Studio! 🎉', 'success');
      location.href = next;
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Create account'; }
  });
}

function initLogin() {
  const form = $('#login-form');
  if (!form) return;
  const next = new URLSearchParams(location.search).get('next') || 'index.html';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      await api('/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
      toast('Welcome back!', 'success');
      location.href = next;
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Sign in'; }
  });
}

function initForgot() {
  const reqForm = $('#forgot-form');
  const resetForm = $('#reset-form');
  if (!reqForm || !resetForm) return;
  const token = new URLSearchParams(location.search).get('token');
  if (token) {
    $('#forgot-block').hidden = true;
    $('#reset-block').hidden = false;
    $('#reset-token').value = token;
  }
  reqForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(reqForm);
    const btn = reqForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const r = await api('/auth/forgot', { method: 'POST', body: { email: fd.get('email') } });
      $('#forgot-block').hidden = true;
      const msg = $('#forgot-msg');
      msg.hidden = false;
      msg.innerHTML = `<p>${esc(r.message)}</p>` + (r.resetUrl
        ? `<p class="demo-note">Demo mode (no email service): <a href="${esc(r.resetUrl)}">open your reset link</a></p>`
        : `<p>If this is a demo install, ask the site owner for your reset link.</p>`);
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Send reset link'; }
  });
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(resetForm);
    if (fd.get('password') !== fd.get('confirm')) return toast('Passwords do not match.', 'error');
    const btn = resetForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Resetting…';
    try {
      await api('/auth/reset', { method: 'POST', body: { token: fd.get('token'), password: fd.get('password') } });
      toast('Password reset! Sign in with your new password.', 'success');
      location.href = 'login.html';
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Reset password'; }
  });
}

/* ---------------- ACCOUNT ---------------- */
async function initAccount() {
  const wrap = $('#account-page');
  if (!wrap) return;
  if (!Auth.user) { location.href = 'login.html?next=account.html'; return; }
  const u = Auth.user;
  wrap.innerHTML = `
    <div class="page-head"><h1>My Account</h1><p>Manage your profile and orders.</p></div>
    <div class="account-grid">
      <aside class="profile-card">
        <div class="avatar avatar-lg">${esc(initials(u.name))}</div>
        <h2>${esc(u.name)}</h2>
        <p class="muted">${esc(u.email)}</p>
        <p class="muted small">Member since ${fmtDate(u.created_at)}</p>
        <button class="btn btn-ghost btn-block" id="acc-logout">Log out</button>
      </aside>
      <div>
        <div class="tabs" role="tablist">
          <button class="tab-btn active" data-tab="orders" role="tab">My Orders</button>
          <button class="tab-btn" data-tab="profile" role="tab">Profile</button>
        </div>
        <div id="acc-orders"></div>
        <div id="acc-profile" hidden>
          <div class="panel">
            <h3>Profile</h3>
            <div class="kv"><span>Full name</span><strong>${esc(u.name)}</strong></div>
            <div class="kv"><span>Email</span><strong>${esc(u.email)}</strong></div>
            <div class="kv"><span>Role</span><strong>${esc(u.role)}</strong></div>
            <p class="muted small">Need to update your details? <a href="support.html">Contact support</a>.</p>
          </div>
        </div>
      </div>
    </div>`;
  $('#acc-logout').addEventListener('click', logout);
  $$('.tab-btn').forEach((b) => b.addEventListener('click', () => {
    $$('.tab-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $('#acc-orders').hidden = b.dataset.tab !== 'orders';
    $('#acc-profile').hidden = b.dataset.tab !== 'profile';
  }));
  const ordersWrap = $('#acc-orders');
  ordersWrap.innerHTML = `<div class="skeleton" style="height:160px;border-radius:14px"></div>`;
  try {
    const { orders } = await api('/orders');
    if (!orders.length) {
      ordersWrap.innerHTML = `<div class="empty-state"><h3>No orders yet</h3><p>Your purchases will appear here.</p><a class="btn btn-primary" href="templates.html">Browse templates</a></div>`;
      return;
    }
    ordersWrap.innerHTML = orders.map((o) => {
      const paid = ['Paid', 'Completed'].includes(o.status);
      return `
      <div class="order-card panel">
        <div class="order-head">
          <div><strong>Order #${o.id}</strong> <span class="muted">· ${fmtDate(o.created_at)}</span></div>
          <span class="badge badge-${o.status.toLowerCase()}">${o.status}</span>
        </div>
        ${o.items.map((it) => `
        <div class="order-item-row">
          <div><strong>${esc(it.title)}</strong> <span class="muted">${money(it.price)}</span></div>
          ${paid ? `<button class="btn btn-primary btn-sm" data-dl="${o.id}/${it.template_id}" data-name="${esc(it.title)}">⬇ Download</button>`
                 : `<span class="muted small">Locked</span>`}
        </div>`).join('')}
        <div class="order-foot">
          <span>Total: <strong>${money(o.total)}</strong> via ${esc(o.payment?.label || o.payment_method)}</span>
          ${o.status === 'Pending' ? `<a class="btn btn-ghost btn-sm" href="order-success.html?id=${o.id}">Complete payment</a>` : ''}
        </div>
      </div>`;
    }).join('');
    $$('[data-dl]', ordersWrap).forEach((b) => b.addEventListener('click', () =>
      downloadFile(`/download/${b.dataset.dl}`, `${b.dataset.name}.zip`).catch((e) => toast(e.message, 'error'))));
  } catch (e) { ordersWrap.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

/* ---------------- page router ---------------- */
const PAGES = {
  home: initHome, templates: initTemplates, template: initTemplate, cart: initCart,
  checkout: initCheckout, order: initOrderSuccess, contact: initContact, support: initSupport,
  register: initRegister, login: initLogin, forgot: initForgot, account: initAccount,
};
function onPageReady() {
  const fn = PAGES[document.body.dataset.page];
  if (fn) Promise.resolve(fn()).catch((err) => { console.error(err); toast(err.message || 'Something went wrong.', 'error'); });
}
if (window.__wcReady) onPageReady();
else document.addEventListener('wc:ready', onPageReady);