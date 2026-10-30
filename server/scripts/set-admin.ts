/**
 * Rotate the admin credentials in the database and sign out every admin session.
 *
 *   ADMIN_USERNAME=... ADMIN_PASSWORD=... npm run admin:credentials
 *
 * Run it from the project root (it opens server/data/app.db). Safe to run while
 * the server is up.
 */
import { db } from '../lib/db.js';
import { setSetting } from '../core/schema.js';
import { hashPassword } from '../core/util.js';

const username = (process.env.ADMIN_USERNAME ?? '').trim();
const password = process.env.ADMIN_PASSWORD ?? '';

if (username.length < 4) {
  console.error('ADMIN_USERNAME must be at least 4 characters.');
  process.exit(1);
}
if (password.length < 16) {
  console.error('ADMIN_PASSWORD must be at least 16 characters.');
  process.exit(1);
}

setSetting('admin_username', username);
setSetting('admin_password_hash', hashPassword(password));
const revoked = db.prepare('DELETE FROM admin_tokens').run().changes;

console.log(`[admin] credentials updated for "${username}"; ${revoked} admin session(s) revoked.`);
