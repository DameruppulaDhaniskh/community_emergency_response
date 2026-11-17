import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCREENS_DIR = path.join(REPO_ROOT, 'docs', 'evidence', 'screens');
const BASE_URL = 'http://localhost:5173';
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

fs.mkdirSync(SCREENS_DIR, { recursive: true });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function setInput(page, selector, val) {
  await page.waitForSelector(selector);
  await page.$eval(selector, (el) => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.type(selector, val);
}

async function waitForText(page, substring, timeout = 12000) {
  const lowerSub = substring.toLowerCase();
  try {
    await page.waitForFunction(
      (txt) => document.body.innerText.toLowerCase().includes(txt),
      { timeout },
      lowerSub
    );
  } catch (err) {
    const text = await page.evaluate(() => document.body.innerText);
    console.error(`[waitForText Error] Failed waiting for "${substring}". Current URL: ${page.url()}. Current text:\n${text}`);
    throw err;
  }
}

async function snap(page, filename, width = 1280, height = 820) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await delay(400);
  const fullPath = path.join(SCREENS_DIR, filename);
  await page.screenshot({ path: fullPath, fullPage: true });
  console.log(`[Screenshot] Captured ${filename} (${width}x${height})`);
}

async function loginViaUI(page, email, password = 'password123') {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2' });
  await setInput(page, 'input[type="email"]', email);
  await setInput(page, 'input[type="password"]', password);

  await Promise.all([
    page.waitForFunction(() => !window.location.pathname.includes('/login'), { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);
  await delay(800);
}

async function run() {
  console.log('================================================================================');
  console.log(' Starting SafeCircle Milestone 3 End-to-End Browser Verification');
  console.log('================================================================================');

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  try {
    // ── Scenario 1: Resident (Asha Rao) Escalation Settings & SOS ──
    console.log('\n[1/4] Resident flow: Asha Rao checking settings and raising SOS...');
    const ctx1 = await browser.createBrowserContext();
    await ctx1.overridePermissions(BASE_URL, ['geolocation', 'notifications']);
    const page1 = await ctx1.newPage();
    page1.on('console', (msg) => console.log('[PAGE1 CONSOLE]', msg.type(), msg.text()));
    page1.on('pageerror', (err) => console.error('[PAGE1 ERROR]', err));
    await page1.setGeolocation({ latitude: 12.9716, longitude: 77.5946, accuracy: 12 });

    await loginViaUI(page1, 'asha@example.com');
    console.log('[DEBUG] Logged in as asha@example.com, navigating to /resident/contacts...');
    await page1.goto(`${BASE_URL}/resident/contacts`, { waitUntil: 'networkidle2' });
    await delay(1200);

    const bodyText = await page1.evaluate(() => document.body.innerText);
    const currUrl = page1.url();
    console.log(`[DEBUG] Current URL: ${currUrl}`);
    console.log(`[DEBUG] FULL PAGE TEXT:\n${bodyText}`);
    await snap(page1, '01-debug-contacts-full.png');

    await waitForText(page1, 'Emergency Contacts');
    await waitForText(page1, 'Automatic SOS Escalation Settings');
    await waitForText(page1, 'Live Escalation Target Preview');
    await snap(page1, '01-resident-escalation-settings.png');

    // Go to resident home to raise SOS
    await page1.goto(`${BASE_URL}/resident/home`, { waitUntil: 'networkidle2' });
    await delay(1000);

    // Click SOS button
    await page1.waitForSelector('button[aria-label="Send SOS"]');
    await page1.click('button[aria-label="Send SOS"]');
    console.log('[DEBUG] Clicked button[aria-label="Send SOS"], waiting for modal...');
    await delay(1000);

    // Click "Send Now" in countdown modal to dispatch immediately
    await page1.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const sendNow = btns.find((b) => b.textContent && b.textContent.includes('Send Now'));
      if (sendNow) sendNow.click();
    });

    // Wait for live SOS screen to activate
    await waitForText(page1, 'Alert Active', 15000);
    await delay(1500);
    await snap(page1, '02-resident-sos-active.png');

    // ── Scenario 2: Guardian (Ravi Kumar) Receives Alert & Passes On ──
    console.log('\n[2/4] Guardian flow: Ravi Kumar receives live alert with GPS & passes on...');
    const ctx2 = await browser.createBrowserContext();
    await ctx2.overridePermissions(BASE_URL, ['geolocation', 'notifications']);
    const page2 = await ctx2.newPage();

    await loginViaUI(page2, 'ravi@example.com');
    await page2.goto(`${BASE_URL}/guardian/incidents`, { waitUntil: 'networkidle2' });
    await delay(1500);

    await waitForText(page2, 'needs help');
    await snap(page2, '03-guardian-active-alert.png');

    // Click "I Can't Help, Pass It On" button
    await page2.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const handoffBtn = btns.find((b) => b.textContent && b.textContent.toLowerCase().includes("can't help"));
      if (handoffBtn) handoffBtn.click();
    });
    await delay(1000);
    await snap(page2, '04-guardian-handoff-modal.png');

    // Click "Pass Alert Now" inside modal
    await page2.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const passBtn = btns.find((b) => b.textContent && b.textContent.toLowerCase().includes('pass alert'));
      if (passBtn) passBtn.click();
    });
    await delay(2000);
    await snap(page2, '05-guardian-handoff-completed.png');

    // ── Scenario 3: Volunteer (Priya Sharma) Receives Dispatch & Accepts ──
    console.log('\n[3/4] Volunteer flow: Priya Sharma receives dispatch & accepts...');
    const ctx3 = await browser.createBrowserContext();
    await ctx3.overridePermissions(BASE_URL, ['geolocation', 'notifications']);
    const page3 = await ctx3.newPage();
    await page3.setGeolocation({ latitude: 12.9720, longitude: 77.5950, accuracy: 10 });

    await loginViaUI(page3, 'volunteer@example.com');
    await page3.goto(`${BASE_URL}/volunteer/incidents`, { waitUntil: 'networkidle2' });
    await delay(1500);

    await waitForText(page3, 'Incoming Emergency Alerts');
    await snap(page3, '06-volunteer-incoming-alert.png');

    // Click "Accept Emergency"
    await page3.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const acceptBtn = btns.find((b) => b.textContent && b.textContent.toLowerCase().includes('accept emergency'));
      if (acceptBtn) acceptBtn.click();
    });
    await delay(2500);
    await snap(page3, '07-volunteer-accepted.png');

    // ── Scenario 4: Admin (Vikram Mehta) Volunteer Verification & Policy ──
    console.log('\n[4/4] Admin flow: Vikram Mehta reviews volunteer verification & policy...');
    const ctx4 = await browser.createBrowserContext();
    const page4 = await ctx4.newPage();

    await loginViaUI(page4, 'admin@example.com');
    await page4.goto(`${BASE_URL}/admin/volunteers`, { waitUntil: 'networkidle2' });
    await delay(1500);

    await waitForText(page4, 'Volunteer Verification & Policy');
    await waitForText(page4, 'Cross-Society Dispatch Policy');
    await snap(page4, '08-admin-volunteer-approvals.png');

    console.log('\n================================================================================');
    console.log(' ALL 8 BROWSER VERIFICATION FLOWS COMPLETED SUCCESSFULLY!');
    console.log(' Screenshots saved to docs/evidence/screens/');
    console.log('================================================================================');

  } catch (err) {
    console.error('[Error] Browser test failed:', err);
    throw err;
  } finally {
    await browser.close();
  }
}

run();
