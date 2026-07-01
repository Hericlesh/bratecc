/**
 * Garante que o .env do backend sobrescreva DATABASE_URL vinda do sistema (ex.: PowerShell).
 */
const path = require('path');
const { execSync } = require('child_process');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: true,
});

const args = process.argv.slice(2);
const cwd = path.join(__dirname, '..');
const quoted = args.map((a) => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');
const cmd = `npx prisma ${quoted}`;

try {
  execSync(cmd, { stdio: 'inherit', cwd, env: process.env });
} catch (e) {
  process.exit(e.status ?? 1);
}
