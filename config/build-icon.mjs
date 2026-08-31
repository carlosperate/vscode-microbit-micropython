import { chromium } from 'playwright';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsPath = path.join(__dirname, '..', 'assets');
const svgPath = path.join(__dirname, 'icon.svg');
const pngPath = path.join(assetsPath, 'icon.png');

// VS Code recommends a 256x256 extension icon for Retina displays.
// Playwright is already installed transitively by @vscode/test-web.
const SIZE = 256;

async function main() {
  const svg = readFileSync(svgPath, 'utf8');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
    await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    await page.evaluate((size) => {
      const svgEl = document.querySelector('svg');
      svgEl.setAttribute('width', String(size));
      svgEl.setAttribute('height', String(size));
    }, SIZE);
    const svgEl = await page.$('svg');
    await svgEl.screenshot({ path: pngPath, omitBackground: true });
  } finally {
    await browser.close();
  }

  const { size } = statSync(pngPath);
  if (size === 0) {
    throw new Error(`${pngPath} was written empty`);
  }
  console.log(`Wrote ${path.relative(process.cwd(), pngPath)} (${SIZE}x${SIZE})`);
}

main();
