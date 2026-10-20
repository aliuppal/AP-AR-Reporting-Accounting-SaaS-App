import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const children = [];

function run(label, command, args) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => {
    if (code && code !== 0) console.error(`[dev] ${label} exited with ${code}`);
  });
  children.push(child);
  return child;
}

run('web', process.execPath, [join(root, 'scripts', 'build.mjs'), '--watch']);
run('api', process.execPath, ['--watch', join(root, 'server', 'src', 'index.js')]);

const shutdown = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[dev] API on http://127.0.0.1:4100 · rebuilds web/dist on change');
