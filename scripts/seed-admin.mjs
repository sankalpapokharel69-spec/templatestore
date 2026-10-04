#!/usr/bin/env node
/* ============================================================
   WebCraft Studio — create/reset the first admin user.
   Usage:  node scripts/seed-admin.mjs admin@example.com 'S3curePass!' [--local]
   --local seeds the local dev database instead of the remote one.
   Uses the exact same PBKDF2-SHA256 parameters as the Worker.
   ============================================================ */
import { webcrypto } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ITER = 100000;
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

async function hashPassword(password) {
  const salt = new Uint8Array(webcrypto.getRandomValues(new Uint8Array(16)));
  const key = await webcrypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$${ITER}$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}

const [email, password, ...rest] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node scripts/seed-admin.mjs <email> <password> [--local]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}
const local = rest.includes('--local');
const hash = await hashPassword(password);
const safeEmail = email.replace(/'/g, "''");
const sql = `INSERT INTO users (name, email, password_hash, role)\nVALUES ('Site Admin', '${safeEmail}', '${hash}', 'admin')\nON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin';\n`;
const file = 'seed-admin.tmp.sql';
writeFileSync(file, sql);
const cmd = `npx wrangler d1 execute webcraft-db ${local ? '--local' : '--remote'} --file=${file}`;
console.log(`Running: ${cmd}\n`);
try {
  execSync(cmd, { stdio: 'inherit' });
  console.log(`\n✓ Admin ready: ${email} (role=admin)`);
  console.log('  Sign in at /login.html, then open /admin/ to manage the store.');
} finally {
  unlinkSync(file);
}