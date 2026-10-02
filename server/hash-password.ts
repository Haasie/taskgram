import { createInterface } from 'node:readline';
import { hashPassword } from './auth/password.js';

/** Gebruik: `npm run hash-password` (of in Docker: `node dist-server/server/hash-password.js`). */
async function readPassword(): Promise<string> {
  if (process.argv[2]) return process.argv[2];
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  return new Promise((resolve) => rl.question('Password: ', (answer) => (rl.close(), resolve(answer))));
}

const password = await readPassword();
if (password.length < 12) {
  console.error('Use at least 12 characters.');
  process.exit(1);
}
console.log(await hashPassword(password));
