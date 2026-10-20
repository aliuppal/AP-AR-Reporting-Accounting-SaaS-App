import { writeFileSync, mkdirSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const url = 'https://fonts.googleapis.com/css2?family=Anton&family=Space+Grotesk:wght@300;400;500;700&family=JetBrains+Mono:wght@400;600;700&display=swap';

const css = await (await fetch(url, { headers: { 'user-agent': UA } })).text();
console.log('css bytes:', css.length);

mkdirSync('web/public/fonts', { recursive: true });

// Keep only the latin subsets, and pull each woff2 down locally.
const blocks = css.split('@font-face').slice(1).map((b) => b.split('}')[0]);
const faces = [];
for (const block of blocks) {
  const family = /font-family:\s*'([^']+)'/.exec(block)?.[1];
  const weight = /font-weight:\s*(\d+)/.exec(block)?.[1];
  const style = /font-style:\s*(\w+)/.exec(block)?.[1];
  const range = /unicode-range:\s*([^;]+)/.exec(block)?.[1] ?? '';
  const src = /url\((https:[^)]+\.woff2)\)/.exec(block)?.[1];
  if (!family || !src) continue;
  // Google returns latin, latin-ext, vietnamese…: keep the plain latin block only.
  if (!range.includes('U+0000-00FF')) continue;
  faces.push({ family, weight, style, src });
}

const out = [];
for (const face of faces) {
  const file = `${face.family.replace(/\s+/g, '')}-${face.weight}${face.style === 'italic' ? '-italic' : ''}.woff2`;
  const res = await fetch(face.src, { headers: { 'user-agent': UA } });
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(`web/public/fonts/${file}`, buf);
  out.push(`@font-face{font-family:'${face.family}';font-style:${face.style};font-weight:${face.weight};font-display:swap;src:url('/fonts/${file}') format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}`);
  console.log(`saved ${file} (${(buf.length / 1024).toFixed(0)} kB)`);
}

writeFileSync('web/public/fonts/fonts.css', `${out.join('\n')}\n`);
console.log('faces:', faces.length);
