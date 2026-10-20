import { rollup } from 'rollup';
import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateIcons } from './icons.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'web', 'dist');
const watch = process.argv.includes('--watch');

function copyStatic() {
  mkdirSync(outDir, { recursive: true });
  cpSync(join(root, 'web', 'index.html'), join(outDir, 'index.html'));
  cpSync(join(root, 'web', 'styles.css'), join(outDir, 'styles.css'));
  cpSync(join(root, 'web', 'motion.css'), join(outDir, 'motion.css'));
  cpSync(join(root, 'web', 'theme-verge.css'), join(outDir, 'theme-verge.css'));
  cpSync(join(root, 'web', 'public'), outDir, { recursive: true });
  // index.html lives at the root of dist and references /app.js
  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  writeFileSync(join(outDir, 'index.html'), html);
}

async function build() {
  rmSync(join(outDir, 'app.js'), { force: true });
  const bundle = await rollup({
    input: join(root, 'web', 'src', 'main.tsx'),
    plugins: [
      replace({ preventAssignment: true, 'process.env.NODE_ENV': JSON.stringify('production') }),
      resolve({ browser: true, extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'] }),
      commonjs({ include: /node_modules/ }),
      babel({
        babelHelpers: 'bundled',
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
        presets: [
          ['@babel/preset-react', { runtime: 'automatic' }],
          ['@babel/preset-typescript', { isTSX: true, allExtensions: true }],
        ],
        exclude: /node_modules/,
      }),
      terser({ format: { comments: false }, compress: { passes: 1 } }),
    ],
    onwarn(warning, warn) {
      if (warning.code === 'CIRCULAR_DEPENDENCY' || warning.code === 'THIS_IS_UNDEFINED') return;
      warn(warning);
    },
  });

  await bundle.write({
    file: join(outDir, 'app.js'),
    format: 'es',
    sourcemap: true,
    inlineDynamicImports: true,
  });

  const bytes = readFileSync(join(outDir, 'app.js')).length;
  return bytes;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  copyStatic();
  generateIcons(outDir);
  const started = Date.now();
  const bytes = await build();
  console.log(`[build] web/dist/app.js ${(bytes / 1024).toFixed(0)} kB in ${Date.now() - started} ms`);

  if (watch) {
    const { watch: rollupWatch } = await import('rollup');
    rollupWatch({
      input: join(root, 'web', 'src', 'main.tsx'),
      output: { file: join(outDir, 'app.js'), format: 'es', sourcemap: true },
      plugins: [
        replace({ preventAssignment: true, 'process.env.NODE_ENV': JSON.stringify('production') }),
        resolve({ browser: true, extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'] }),
        commonjs({ include: /node_modules/ }),
        babel({
          babelHelpers: 'bundled',
          extensions: ['.ts', '.tsx', '.js', '.jsx'],
          presets: [
            ['@babel/preset-react', { runtime: 'automatic' }],
            ['@babel/preset-typescript', { isTSX: true, allExtensions: true }],
          ],
          exclude: /node_modules/,
        }),
      ],
    }).on('event', (event) => {
      if (event.code === 'BUNDLE_END') console.log(`[watch] rebuilt in ${event.duration} ms`);
      if (event.code === 'ERROR') console.error(event.error);
    });
    console.log('[watch] watching web/src…');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
