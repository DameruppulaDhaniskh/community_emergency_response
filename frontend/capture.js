import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

export async function capture(urlOrFile, outputPath, width = 1280, height = 800) {
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    defaultViewport: { width, height }
  });

  const page = await browser.newPage();
  await page.setViewport({ width, height });

  let targetUrl = urlOrFile;
  if (!urlOrFile.startsWith('http://') && !urlOrFile.startsWith('https://')) {
    targetUrl = 'file:///' + path.resolve(urlOrFile).replace(/\\/g, '/');
  }

  await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.screenshot({ path: outputPath, fullPage: false });
  await browser.close();
  console.log(`Captured ${targetUrl} -> ${outputPath} (${width}x${height})`);
}

// CLI usage: node capture.js <urlOrFile> <outputPath> [width] [height]
if (process.argv[2] && process.argv[3]) {
  const w = parseInt(process.argv[4] || '1280', 10);
  const h = parseInt(process.argv[5] || '800', 10);
  capture(process.argv[2], process.argv[3], w, h).catch(err => {
    console.error('Capture error:', err);
    process.exit(1);
  });
}
