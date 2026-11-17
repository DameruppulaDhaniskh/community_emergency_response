import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCREENS_DIR = path.join(REPO_ROOT, 'docs', 'evidence', 'screens');
const SAMPLE_IMAGE = path.join(REPO_ROOT, 'docs', 'postman', 'sample_evidence.png');
const BASE_URL = 'http://127.0.0.1:4173';
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

fs.mkdirSync(SCREENS_DIR, { recursive: true });

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForText(page, substring, timeout = 12000) {
  await page.waitForFunction(
    (txt) => document.body.innerText.includes(txt),
    { timeout },
    substring
  );
}

async function clickButtonContaining(page, text) {
  const clicked = await page.evaluate((needle) => {
    const candidates = Array.from(document.querySelectorAll('button, a'));
    const el = candidates.find(
      (n) => n.textContent && n.textContent.trim().toLowerCase().includes(needle.toLowerCase())
    );
    if (!el) return false;
    el.click();
    return true;
  }, text);
  if (!clicked) {
    throw new Error(`Could not find clickable element containing "${text}" on ${page.url()}`);
  }
}

async function snap(page, filename, width = 1280, height = 820) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await delay(350);
  const fullPath = path.join(SCREENS_DIR, filename);
  await page.screenshot({ path: fullPath, fullPage: true });
  console.log(`Captured ${filename} (${width}x${height})`);
}

async function setupContext(browser) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(BASE_URL, ['geolocation', 'notifications']);
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 820 });
  await page.setGeolocation({ latitude: 12.9716, longitude: 77.5946, accuracy: 12 });

  const errors = [];
  page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) {
      errors.push(`HTTP ${res.status()} ${res.url()}`);
    }
  });
  return { ctx, page, errors };
}

async function login(page, email, password = 'password123') {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[type="email"]');
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', password);
  await Promise.all([
    page.waitForFunction(() => !window.location.pathname.includes('/login'), { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);
  await delay(600);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const allErrors = [];

  try {
    // 1. Resident context: PWA check + Incident Report + List + Detail + Offline banner
    console.log('--- 1. Resident Flow & PWA Checks ---');
    const resident = await setupContext(browser);
    await login(resident.page, 'asha@example.com');

    // Verify service worker + manifest
    const pwaInfo = await resident.page.evaluate(async () => {
      const manifestLink = document.querySelector('link[rel="manifest"]')?.getAttribute('href') || null;
      let swState = 'not-supported';
      let swScope = null;
      if ('serviceWorker' in navigator) {
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);
        if (reg) {
          swState = reg.active ? reg.active.state : 'installing';
          swScope = reg.scope;
        } else {
          swState = 'not-ready';
        }
      }
      return { manifestLink, swState, swScope };
    });
    console.log('PWA status:', JSON.stringify(pwaInfo));
    if (!pwaInfo.manifestLink) throw new Error('Missing web app manifest link');

    // Navigate to Report Incident page
    await resident.page.goto(`${BASE_URL}/resident/report`, { waitUntil: 'networkidle0' });
    await resident.page.waitForSelector('#incident-title');
    const reportTitle = `Water main leak Block A (${Date.now()})`;
    await resident.page.type('#incident-title', reportTitle);
    await clickButtonContaining(resident.page, 'Fire');
    await resident.page.type('#incident-desc', 'Smoke near Block A pump panel, immediate check needed.');

    // Capture GPS
    await clickButtonContaining(resident.page, 'Capture Current Location');
    await waitForText(resident.page, '12.9716');

    // Upload sample PNG evidence
    const fileInput = await resident.page.$('input[type="file"]');
    await fileInput.uploadFile(SAMPLE_IMAGE);
    await waitForText(resident.page, '1 / 5 photos');

    await snap(resident.page, 'report-form-1280.png', 1280, 860);
    await snap(resident.page, 'report-form-390.png', 390, 844);
    await resident.page.setViewport({ width: 1280, height: 820 });

    // Submit form & follow redirect to /resident/incidents/:id
    await Promise.all([
      resident.page.waitForFunction(() => /\/resident\/incidents\/\d+/.test(window.location.pathname), {
        timeout: 15000,
      }),
      clickButtonContaining(resident.page, 'Submit Incident Report'),
    ]);
    await waitForText(resident.page, reportTitle);
    const createdUrl = resident.page.url();
    const matchId = createdUrl.match(/\/incidents\/(\d+)/);
    if (!matchId) throw new Error(`Could not extract incident id from ${createdUrl}`);
    const incidentId = matchId[1];
    console.log(`Created incident #${incidentId}`);

    await snap(resident.page, 'incident-detail-1280.png', 1280, 860);
    await snap(resident.page, 'incident-detail-390.png', 390, 844);

    // Resident incident list
    await resident.page.goto(`${BASE_URL}/resident/incidents`, { waitUntil: 'networkidle0' });
    await waitForText(resident.page, reportTitle);
    await snap(resident.page, 'incident-list-1280.png', 1280, 860);

    // Offline banner check (desktop + mobile)
    await resident.page.setOfflineMode(true);
    await resident.page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await delay(400);
    const offlineVisible = await resident.page.evaluate(() =>
      document.body.innerText.toLowerCase().includes('offline')
    );
    if (!offlineVisible) throw new Error('Offline banner did not appear when offline');
    await snap(resident.page, 'offline-banner-1280.png', 1280, 820);
    await snap(resident.page, 'offline-banner-390.png', 390, 844);
    await resident.page.setOfflineMode(false);
    await resident.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await delay(400);

    // 2. Outsider Resident Privacy Check (404 enforced)
    console.log('--- 2. Role Restriction Check ---');
    const outsider = await setupContext(browser);
    await login(outsider.page, 'kiran@example.com');
    await outsider.page.goto(`${BASE_URL}/resident/incidents/${incidentId}`, { waitUntil: 'networkidle0' });
    await delay(600);
    const outsiderSawTitle = await outsider.page.evaluate(
      (t) => document.body.innerText.includes(t),
      reportTitle
    );
    if (outsiderSawTitle) throw new Error('PRIVACY VIOLATION: Unrelated resident saw incident details!');
    console.log('Confirmed unrelated resident cannot view incident details.');
    allErrors.push(...outsider.errors);
    await outsider.ctx.close();

    // 3. Admin Flow: Dashboard -> Search/Click -> Acknowledge -> Assign Modal -> Assign Volunteer
    console.log('--- 3. Admin Flow ---');
    const admin = await setupContext(browser);
    await login(admin.page, 'admin@example.com');
    await admin.page.goto(`${BASE_URL}/admin/dashboard`, { waitUntil: 'networkidle0' });
    await waitForText(admin.page, 'Incident Operations Center');
    await waitForText(admin.page, reportTitle);
    await snap(admin.page, 'admin-dashboard-1280.png', 1280, 860);

    await admin.page.goto(`${BASE_URL}/admin/incidents/${incidentId}`, { waitUntil: 'networkidle0' });
    await waitForText(admin.page, reportTitle);

    await clickButtonContaining(admin.page, 'Acknowledge');
    await waitForText(admin.page, 'Acknowledged');

    await clickButtonContaining(admin.page, 'Assign Volunteer');
    await waitForText(admin.page, 'Assign Available Volunteer');
    await admin.page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('dialog[open] button')).some((b) =>
          b.textContent?.includes('Priya Sharma')
        ),
      { timeout: 12000 }
    );
    await admin.page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('dialog[open] button')).find((b) =>
        b.textContent?.includes('Priya Sharma')
      );
      btn?.click();
    });
    await admin.page.type('#assign-note', 'Proceed to Block A pump panel with safety gear.');
    await snap(admin.page, 'admin-assign-modal-1280.png', 1280, 860);

    await admin.page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('dialog[open] button')).find((b) =>
        b.textContent?.includes('Confirm Assignment')
      );
      btn?.click();
    });
    await admin.page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 12000 });
    await waitForText(admin.page, 'Assigned Volunteer');
    await waitForText(admin.page, 'Priya Sharma');
    console.log('Admin acknowledged and assigned incident to Priya Sharma.');

    // 4. Volunteer Flow: Assignment List -> Start Work -> Mark Resolved
    console.log('--- 4. Volunteer Flow ---');
    const volunteer = await setupContext(browser);
    await login(volunteer.page, 'volunteer@example.com');
    await volunteer.page.goto(`${BASE_URL}/volunteer/incidents`, { waitUntil: 'networkidle0' });
    await waitForText(volunteer.page, 'My Assignments');
    await waitForText(volunteer.page, reportTitle);
    await snap(volunteer.page, 'volunteer-assignments-1280.png', 1280, 860);

    await volunteer.page.goto(`${BASE_URL}/volunteer/incidents/${incidentId}`, { waitUntil: 'networkidle0' });
    await waitForText(volunteer.page, reportTitle);
    await volunteer.page.type('#vol-action-note', 'Arrived on floor, inspecting switchboard');
    await clickButtonContaining(volunteer.page, 'Start Work');
    await waitForText(volunteer.page, 'Mark Resolved');

    await snap(volunteer.page, 'volunteer-detail-390.png', 390, 844);
    await volunteer.page.setViewport({ width: 1280, height: 820 });

    await volunteer.page.type('#vol-action-note', 'Main breaker isolated, area safe');
    await clickButtonContaining(volunteer.page, 'Mark Resolved');
    await waitForText(volunteer.page, 'Main breaker isolated');
    console.log('Volunteer transitioned incident IN_PROGRESS -> RESOLVED.');
    allErrors.push(...volunteer.errors);
    await volunteer.ctx.close();

    // 5. Admin Closes Incident
    console.log('--- 5. Admin Close Flow ---');
    await admin.page.reload({ waitUntil: 'networkidle0' });
    await waitForText(admin.page, 'Close Incident');
    await clickButtonContaining(admin.page, 'Close Incident');
    await admin.page.waitForSelector('dialog[open] #close-reason-input');
    await admin.page.type('#close-reason-input', 'Verified electrical isolation complete and logged');
    await admin.page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('dialog[open] button')).find((b) =>
        b.textContent?.includes('Confirm Close')
      );
      btn?.click();
    });
    await admin.page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 12000 });
    await waitForText(admin.page, 'Verified electrical isolation');
    console.log('Admin transitioned incident RESOLVED -> CLOSED.');
    allErrors.push(...admin.errors);
    await admin.ctx.close();

    // 6. Resident Notifications & Mark All Read Flow
    console.log('--- 6. Notifications & Mark Read Flow ---');
    await resident.page.goto(`${BASE_URL}/notifications`, { waitUntil: 'networkidle0' });
    await waitForText(resident.page, 'Notifications');
    await delay(800);
    await snap(resident.page, 'notifications-1280.png', 1280, 860);
    await snap(resident.page, 'notifications-390.png', 390, 844);

    // Click Mark all read if present
    const hadMarkAll = await resident.page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.toLowerCase().includes('mark all read')
      );
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
      return false;
    });
    if (hadMarkAll) {
      await delay(800);
      console.log('Clicked Mark all read cleanly.');
    }

    allErrors.push(...resident.errors);
    await resident.ctx.close();

    if (allErrors.length > 0) {
      throw new Error(`Console/HTTP errors encountered:\n${allErrors.join('\n')}`);
    }

    console.log('ALL E2E PRODUCTION WORKFLOWS & SCREENSHOTS VERIFIED SUCCESSFULLY!');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('E2E verification failed:', err);
  process.exit(1);
});

