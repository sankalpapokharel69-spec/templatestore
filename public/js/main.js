/* ============================================================
   WebCraft Studio — shared front-end core
   Theme, chrome (navbar/footer), API client, cart, toasts
   ============================================================ */
'use strict';

const API_BASE = window.WEBCRAFT_API || '';
const API = API_BASE + '/api';
const Auth = { user: null };

/* ---------- tiny helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0);
const fmtDate = (s) => {
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  return isNaN(d) ? String(s) : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const initials = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
/* File URLs come back from the API as "/api/files/..." — prefix the API
   base so they also work in local dev (direct worker, no proxy). */
const fileUrl = (path) => API_BASE + path;

async function api(path, { method = 'GET', body, formData } = {}) {
  const opts = { method, credentials: 'include' };
  if (formData) opts.body = formData;
  else if (body !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const res = await fetch(API + path, opts);
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

/* ---------- theme (light/dark, saved + system preference) ---------- */
function initTheme() {
  const saved = localStorage.getItem('wc_theme');
  const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = saved || (sysDark ? 'dark' : 'light');
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('wc_theme', next);
}

/* ---------- toast notifications ---------- */
function toast(msg, type = 'info') {
  let wrap = $('#toasts');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toasts';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); }, 3400);
}

/* ---------- scroll reveal ---------- */
const revealIO = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); }
}, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });
function observeReveals(root = document) { $$('.reveal:not(.in)', root).forEach((el) => revealIO.observe(el)); }

/* ---------- cart (localStorage + server mirror for logged-in users) ---------- */
const CART_KEY = 'wc_cart';
function getCart() {
  try { const v = JSON.parse(localStorage.getItem(CART_KEY)); return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : []; }
  catch { return []; }
}
function saveCart(items) { localStorage.setItem(CART_KEY, JSON.stringify([...new Set(items)])); updateCartBadge(); }
function addToCart(id) {
  const c = getCart();
  if (c.includes(id)) { toast('Already in your cart.', 'info'); return; }
  c.push(id); saveCart(c);
  toast('Added to cart 🛒', 'success');
  syncServerCart();
}
function removeFromCart(id) { saveCart(getCart().filter((x) => x !== id)); syncServerCart(); }
async function syncServerCart() {
  if (!Auth.user) return;
  try { await api('/cart', { method: 'PUT', body: { items: getCart() } }); } catch {}
}
async function mergeServerCart() {
  try {
    const local = getCart();
    const { items: server } = await api('/cart');
    const merged = [...new Set([...local, ...server])];
    if (merged.length !== local.length) saveCart(merged);
    await api('/cart', { method: 'PUT', body: { items: merged } });
  } catch {}
}
function updateCartBadge() {
  const b = $('#cart-badge');
  if (b) { const n = getCart().length; b.textContent = n; b.style.display = n ? '' : 'none'; }
}

/* ---------- authenticated file download (ZIPs) ---------- */
async function downloadFile(path, filename) {
  const res = await fetch(API + path, { credentials: 'include' });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || `Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---------- shared chrome (navbar + footer) ---------- */
const LOGO = `<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="9" fill="url(#lg)"/><path d="M9 11l4 12 4-9 4 9 4-12" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="lg" x1="0" y1="0" x2="34" y2="34"><stop stop-color="#6366f1"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs></svg>`;
const SUN = `<svg class="ico-sun" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4"/></svg>`;
const MOON = `<svg class="ico-moon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>`;
const CART_ICO = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg>`;

function renderChrome() {
  if (document.body.dataset.admin) return;
  const header = $('#site-header');
  if (header) {
    header.className = 'site-header';
    header.innerHTML = `
      <div class="container nav-wrap">
        <a class="brand" href="index.html" aria-label="WebCraft Studio — home">${LOGO}<span>WebCraft<span class="brand-accent">Studio</span></span></a>
        <nav class="nav-links" id="nav-links" aria-label="Main navigation">
          <a href="templates.html">Templates</a>
          <a href="about.html">About</a>
          <a href="support.html">Support</a>
          <a href="contact.html">Contact</a>
          <div class="nav-auth" id="nav-auth"></div>
        </nav>
        <div class="nav-actions">
          <button class="icon-btn theme-toggle" aria-label="Toggle dark mode" title="Toggle theme">${MOON}${SUN}</button>
          <a class="icon-btn cart-link" href="cart.html" aria-label="View cart">${CART_ICO}<span class="cart-badge" id="cart-badge">0</span></a>
          <button class="icon-btn nav-burger" id="nav-burger" aria-label="Open menu" aria-expanded="false"><span></span><span></span><span></span></button>
        </div>
      </div>`;
    $('#nav-burger').addEventListener('click', () => {
      const open = header.classList.toggle('menu-open');
      $('#nav-burger').setAttribute('aria-expanded', String(open));
    });
    $('.theme-toggle', header).addEventListener('click', toggleTheme);
  }
  const footer = $('#site-footer');
  if (footer) {
    footer.innerHTML = `
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <a class="brand" href="index.html">${LOGO}<span>WebCraft<span class="brand-accent">Studio</span></span></a>
            <p>Premium, hand-crafted website templates for every business. Pay once, download forever.</p>
          </div>
          <div><h4>Explore</h4><ul>
            <li><a href="templates.html">All templates</a></li>
            <li><a href="about.html">About us</a></li>
            <li><a href="support.html">Support &amp; FAQ</a></li>
            <li><a href="contact.html">Contact</a></li>
          </ul></div>
          <div><h4>Categories</h4><ul id="footer-cats"></ul></div>
          <div><h4>Account</h4><ul>
            <li><a href="register.html">Create account</a></li>
            <li><a href="login.html">Sign in</a></li>
            <li><a href="account.html">My orders</a></li>
            <li><a href="cart.html">Cart</a></li>
          </ul></div>
        </div>
        <div class="footer-bottom">
          <p>© ${new Date().getFullYear()} WebCraft Studio. All rights reserved.</p>
          <p>Built with ❤️ on Cloudflare</p>
        </div>
      </div>`;
    api('/categories').then(({ categories }) => {
      const ul = $('#footer-cats');
      if (ul) ul.innerHTML = categories.slice(0, 6)
        .map((c) => `<li><a href="templates.html?category=${c.slug}">${esc(c.name)}</a></li>`).join('');
    }).catch(() => {});
  }
  updateAuthUI();
  updateCartBadge();
}

function updateAuthUI() {
  const el = $('#nav-auth');
  if (!el) return;
  if (Auth.user) {
    el.innerHTML = `
      <a href="account.html">My Account</a>
      ${Auth.user.role === 'admin' ? '<a href="admin/index.html">Admin</a>' : ''}
      <button class="btn btn-ghost btn-sm" id="logout-btn">Log out</button>`;
    $('#logout-btn').addEventListener('click', logout);
  } else {
    el.innerHTML = `<a href="login.html">Sign in</a><a class="btn btn-primary btn-sm" href="register.html">Get started</a>`;
  }
}

async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  toast('Signed out. See you soon!', 'info');
  setTimeout(() => { location.href = '/index.html'; }, 500);
}

/* ---------- boot ---------- */
async function boot() {
  initTheme();
  renderChrome();
  observeReveals();
  try { const r = await api('/auth/me'); Auth.user = r.user || null; } catch { Auth.user = null; }
  if (Auth.user) await mergeServerCart();
  updateAuthUI();
  updateCartBadge();
  window.__wcReady = true;
  document.dispatchEvent(new CustomEvent('wc:ready', { detail: { user: Auth.user } }));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();