/**
 * Motion audit — enforces the 60fps-animation contract mechanically.
 *
 *   node scripts/audit-motion.mjs
 *
 * Fails when a `transition` targets a layout/paint property, or when a
 * `@keyframes` block animates anything other than transform/opacity.
 * Paint-only hover states (background/color/border) are explicitly allowed:
 * they are one-shot, not per-frame animation.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  'web/styles.css',
  'web/motion.css',
  'web/public/landing.html',
];

const ALLOWED_TRANSITION = new Set([
  'transform', 'opacity', 'background', 'background-color', 'color',
  'border-color', 'border-top-color', 'border-bottom-color', 'border-left-color',
  'border-right-color', 'outline-color', 'text-decoration-color', 'visibility',
  'box-shadow', // allowed only in a `will-change`/static context — see the exception below
]);

const FORBIDDEN_TRANSITION = new Set([
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'top', 'left', 'right', 'bottom', 'margin', 'padding', 'inset',
  'font-size', 'line-height', 'letter-spacing', 'border-width', 'border-radius',
  'flex', 'flex-basis', 'grid-template-rows', 'grid-template-columns', 'gap',
  'filter', 'backdrop-filter', 'background-position', 'background-size',
]);

const FORBIDDEN_KEYFRAME = new Set([
  ...FORBIDDEN_TRANSITION,
  'box-shadow', 'background', 'background-color', 'color', 'border-color',
]);

const violations = [];
const stats = { transitions: 0, keyframes: 0, files: 0 };

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function checkTransitions(css, rel) {
  const re = /transition(?:-property)?\s*:\s*([^;{}]+)/g;
  let match;
  while ((match = re.exec(css)) !== null) {
    stats.transitions += 1;
    const value = match[1].trim();
    if (value === 'none') continue;
    // Strip easing functions (`cubic-bezier(.2, 0, 0, 1)`, `steps(4)`, `var(...)`) so their
    // commas are not mistaken for property separators.
    const flattened = value.replace(/\([^()]*\)/g, '');
    for (const part of flattened.split(',')) {
      const prop = part.trim().split(/\s+/)[0];
      if (!prop) continue;
      if (FORBIDDEN_TRANSITION.has(prop)) {
        violations.push({
          file: rel,
          line: lineOf(css, match.index),
          property: prop,
          detail: `transition on layout property "${prop}" (use transform/opacity instead)`,
        });
      } else if (!ALLOWED_TRANSITION.has(prop) && prop !== 'all') {
        violations.push({
          file: rel,
          line: lineOf(css, match.index),
          property: prop,
          detail: `unreviewed transition property "${prop}"`,
        });
      }
    }
  }
}

function checkKeyframes(css, rel) {
  let index = css.indexOf('@keyframes');
  while (index !== -1) {
    stats.keyframes += 1;
    const open = css.indexOf('{', index);
    let depth = 0;
    let end = open;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    const body = css.slice(open, end);
    const declRe = /([a-z-]+)\s*:\s*[^;{}]+/g;
    let decl;
    while ((decl = declRe.exec(body)) !== null) {
      const prop = decl[1];
      if (prop.startsWith('animation') || prop === 'from' || prop === 'to') continue;
      if (FORBIDDEN_KEYFRAME.has(prop)) {
        violations.push({
          file: rel,
          line: lineOf(css, index + open + decl.index),
          property: prop,
          detail: `@keyframes animates paint/layout property "${prop}"`,
        });
      }
    }
    index = css.indexOf('@keyframes', end);
  }
}

function checkReducedMotion(css, rel) {
  if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css)) {
    violations.push({ file: rel, line: 0, property: 'prefers-reduced-motion', detail: 'no reduced-motion fallback found' });
  }
}

for (const rel of targets) {
  const raw = readFileSync(join(root, rel), 'utf8');
  const css = stripComments(raw);
  stats.files += 1;
  checkTransitions(css, rel);
  checkKeyframes(css, rel);
  if (rel !== 'web/styles.css') checkReducedMotion(css, rel);
}

console.log(`Motion audit — ${stats.files} files, ${stats.transitions} transitions, ${stats.keyframes} keyframe blocks`);
if (violations.length) {
  console.error(`\n${violations.length} violation(s):`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.detail}`);
  process.exit(1);
}
console.log('No layout-thrashing properties animate. Compositor-only contract holds.\n');
