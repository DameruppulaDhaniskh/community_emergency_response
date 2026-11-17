import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

export async function captureAuthenticated(email, password, route, outputPath, width = 1280, height = 800) {
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    defaultViewport: { width, height }
  });

  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.setViewport({ width, height });

  // Navigate to login
  await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'networkidle0', timeout: 15000 });

  // If already logged in, login redirects away
  const emailInput = await page.$('input[type="email"]');
  if (emailInput) {
    await page.type('input[type="email"]', email);
    await page.type('input[type="password"]', password);

    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {})
    ]);
    await new Promise(r => setTimeout(r, 1200));
  }

  if (route) {
    await page.goto(`http://127.0.0.1:5173${route}`, { waitUntil: 'networkidle0', timeout: 15000 });
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(r => setTimeout(r, 800));
  } else {
    await page.evaluateHandle('document.fonts.ready');
  }

  await page.screenshot({ path: outputPath, fullPage: false });
  await browser.close();
  console.log(`Captured auth route ${route} -> ${outputPath} (${width}x${height})`);
}

if (process.argv[2] && process.argv[3]) {
  const route = process.argv[2];
  const out = process.argv[3];
  const w = parseInt(process.argv[4] || '1280', 10);
  const h = parseInt(process.argv[5] || '800', 10);
  const email = process.argv[6] || 'asha@example.com';
  const pass = process.argv[7] || 'password123';
  captureAuthenticated(email, pass, route, out, w, h).catch(err => {
    console.error('Auth capture error:', err);
    process.exit(1);
  });
}
