import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCREENS_DIR = path.join(REPO_ROOT, 'docs', 'evidence', 'screens');
const BASE_URL = 'http://127.0.0.1:4173';
const API_URL = 'http://127.0.0.1:8000/api';
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

async function clickButtonContaining(page, text, rootSelector = 'body') {
  const ok = await page.evaluate(
    ({ needle, root }) => {
      const container = document.querySelector(root) || document;
      const els = Array.from(container.querySelectorAll('button, a'));
      const target = els.find(
        (el) => !el.disabled && el.textContent && el.textContent.trim().toLowerCase().includes(needle.toLowerCase())
      );
      if (!target) return false;
      target.click();
      return true;
    },
    { needle: text, root: rootSelector }
  );
  if (!ok) {
    throw new Error(`Clickable "${text}" not found inside "${rootSelector}" on ${page.url()}`);
  }
}

async function setInput(page, selector, val) {
  await page.waitForSelector(selector);
  await page.$eval(selector, (el) => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.type(selector, val);
}

async function newProfile(browser) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(BASE_URL, ['geolocation', 'notifications']);
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 860 });
  await page.setGeolocation({ latitude: 12.9716, longitude: 77.5946, accuracy: 10 });
  const errors = [];
  page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`HTTP ${res.status()} ${res.url()}`);
  });
  return { ctx, page, errors };
}

async function registerUserViaUI(page, { roleLabel, firstName, lastName, username, email, phone, password = 'Password123!' }) {
  await page.goto(`${BASE_URL}/register`, { waitUntil: 'networkidle0' });
  await clickButtonContaining(page, roleLabel);
  await setInput(page, '#reg-first-name', firstName);
  await setInput(page, '#reg-last-name', lastName);
  await setInput(page, '#reg-username', username);
  await setInput(page, '#reg-email', email);
  await setInput(page, '#reg-phone', phone);
  await setInput(page, '#reg-password', password);
  await setInput(page, '#reg-confirm-password', password);
  await page.click('button[type="submit"]');
}

async function loginViaUI(page, email, password = 'Password123!') {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
  await setInput(page, 'input[type="email"]', email);
  await setInput(page, 'input[type="password"]', password);
  await Promise.all([
    page.waitForFunction(() => !window.location.pathname.includes('/login'), { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);
  await delay(600);
}

async function snap(page, name) {
  await delay(350);
  await page.screenshot({ path: path.join(SCREENS_DIR, name), fullPage: true });
  console.log(`Captured ${name}`);
}

async function main() {
  const ts = Date.now().toString().slice(-6);
  const resPhone = `97101${ts.slice(-5)}`;
  const resPhoneExtra = `97109${ts.slice(-5)}`;
  const g1PhoneRaw = `97102${ts.slice(-5)}`;
  const g1PhoneFormatted = `+91 ${g1PhoneRaw.slice(0, 5)} ${g1PhoneRaw.slice(5)}`;
  const g2Phone = `97103${ts.slice(-5)}`;

  const resUser = {
    roleLabel: 'Resident',
    firstName: 'Kavya',
    lastName: 'Nair',
    username: `kavya_${ts}`,
    email: `kavya_${ts}@e2e.local`,
    phone: resPhone,
  };
  const g1User = {
    roleLabel: 'Guardian',
    firstName: 'Rohan',
    lastName: 'Nair',
    username: `rohan_${ts}`,
    email: `rohan_${ts}@e2e.local`,
    phone: g1PhoneRaw,
  };
  const g2User = {
    roleLabel: 'Guardian',
    firstName: 'Ananya',
    lastName: 'Nair',
    username: `ananya_${ts}`,
    email: `ananya_${ts}@e2e.local`,
    phone: g2Phone,
  };

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const resultsLog = [];
  const profileA = await newProfile(browser);
  const profileB = await newProfile(browser);
  const profileC = await newProfile(browser);

  try {
    // 1. Register users & test duplicate phone + case-insensitive username errors
    console.log('--- 1. Registration uniqueness checks ---');
    await registerUserViaUI(profileA.page, resUser);
    await profileA.page.waitForFunction(() => window.location.pathname.includes('/login'), { timeout: 12000 });
    resultsLog.push(`Registered resident @${resUser.username} (${resPhone}).`);

    // Same phone -> must fail inline
    await registerUserViaUI(profileA.page, {
      ...resUser,
      username: `kavya_alt_${ts}`,
      email: `kavya_alt_${ts}@e2e.local`,
      phone: `+91 ${resPhone.slice(0, 5)} ${resPhone.slice(5)}`,
    });
    await waitForText(profileA.page, 'This phone number is already registered.');
    resultsLog.push('Duplicate formatted phone on /register rejected with inline error.');

    // Same username in uppercase -> must fail inline
    await registerUserViaUI(profileA.page, {
      ...resUser,
      username: resUser.username.toUpperCase(),
      email: `kavya_case_${ts}@e2e.local`,
      phone: resPhoneExtra,
    });
    await waitForText(profileA.page, 'This username is taken.');
    resultsLog.push('Case-insensitive duplicate username on /register rejected with inline error.');

    // Register Guardian 1 & Guardian 2
    await registerUserViaUI(profileB.page, g1User);
    await profileB.page.waitForFunction(() => window.location.pathname.includes('/login'), { timeout: 12000 });
    await registerUserViaUI(profileC.page, g2User);
    await profileC.page.waitForFunction(() => window.location.pathname.includes('/login'), { timeout: 12000 });
    resultsLog.push(`Registered guardians @${g1User.username} and @${g2User.username}.`);

    // 2. Resident logs in -> No verified guardian warning -> Add Modal negative + username lookup
    console.log('--- 2. Resident login, negative lookups & add by username ---');
    await loginViaUI(profileA.page, resUser.email);
    await profileA.page.goto(`${BASE_URL}/resident/contacts`, { waitUntil: 'networkidle0' });
    await waitForText(profileA.page, 'No verified guardian yet');

    await clickButtonContaining(profileA.page, 'Add Contact / Guardian');
    await profileA.page.waitForSelector('#lookup-identifier');

    // Verify Send request is disabled initially
    const initialDisabled = await profileA.page.$eval(
      '[role="dialog"] button[type="submit"]',
      (el) => el.disabled
    );
    if (!initialDisabled) throw new Error('Send request button should start disabled!');

    // Negative: unknown username
    await setInput(profileA.page, '#lookup-identifier', `unknown_${ts}`);
    await clickButtonContaining(profileA.page, 'Find', '[role="dialog"]');
    await waitForText(profileA.page, 'No account found');

    // Negative: non-guardian (seeded volunteer_demo)
    await setInput(profileA.page, '#lookup-identifier', 'volunteer_demo');
    await clickButtonContaining(profileA.page, 'Find', '[role="dialog"]');
    await waitForText(profileA.page, 'Only Guardian accounts');

    // Negative: self
    await setInput(profileA.page, '#lookup-identifier', resUser.username);
    await clickButtonContaining(profileA.page, 'Find', '[role="dialog"]');
    await waitForText(profileA.page, 'your own account');
    resultsLog.push('Negative lookup checks (unknown, non-guardian, self) blocked cleanly.');

    // Valid lookup by case-insensitive username
    await setInput(profileA.page, '#lookup-identifier', g1User.username.toUpperCase());
    await clickButtonContaining(profileA.page, 'Find', '[role="dialog"]');
    await waitForText(profileA.page, 'Rohan Nair');
    await waitForText(profileA.page, `+91 ******${g1PhoneRaw.slice(-4)}`);
    await snap(profileA.page, 'guardian-lookup-1280.png');

    await clickButtonContaining(profileA.page, 'Send request', '[role="dialog"]');
    await waitForText(profileA.page, 'Pending (waiting for guardian)');
    await snap(profileA.page, 'guardian-pending-resident-1280.png');
    resultsLog.push('Resident sent primary guardian request by username; status shows Pending.');

    // Pre-acceptance SOS check: resident triggers SOS via API while pending
    const resToken = await profileA.page.evaluate(() => localStorage.getItem('access_token'));
    const preSosResp = await profileA.page.evaluate(
      async ({ api, token }) => {
        const r = await fetch(`${api}/incidents/sos/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ emergency_type: 'medical', description: 'Before accept check' }),
        });
        return { status: r.status, data: await r.json() };
      },
      { api: API_URL, token: resToken }
    );
    if (preSosResp.status !== 201) throw new Error('Pre-accept SOS failed');
    const preSosId = preSosResp.data.id;

    // 3. Guardian logs in -> sees pending request & badge & notification, CANNOT see pre-accept SOS
    console.log('--- 3. Guardian pending requests, badge, pre-accept 404 & accept ---');
    await loginViaUI(profileB.page, g1User.email);
    await profileB.page.goto(`${BASE_URL}/guardian/alerts`, { waitUntil: 'networkidle0' });
    await waitForText(profileB.page, 'Guardian Requests');
    await waitForText(profileB.page, 'Kavya Nair');
    await snap(profileB.page, 'guardian-requests-1280.png');

    // Confirm Guardian cannot access preSosId before accepting
    const g1Token = await profileB.page.evaluate(() => localStorage.getItem('access_token'));
    const preAccessStatus = await profileB.page.evaluate(
      async ({ api, token, id }) => {
        const r = await fetch(`${api}/incidents/${id}/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return r.status;
      },
      { api: API_URL, token: g1Token, id: preSosId }
    );
    if (preAccessStatus !== 404) throw new Error(`Expected 404 before accept, got ${preAccessStatus}`);
    resultsLog.push(`Before guardian acceptance, GET /api/incidents/${preSosId}/ returned 404.`);

    // Check Guardian notification exists
    await profileB.page.goto(`${BASE_URL}/notifications`, { waitUntil: 'networkidle0' });
    await waitForText(profileB.page, 'Guardian Request from Kavya Nair');
    await profileB.page.goto(`${BASE_URL}/guardian/alerts`, { waitUntil: 'networkidle0' });

    // Check Negative: Guardian 2 trying to accept Guardian 1's request returns 404; Resident self-verify returns 410
    await loginViaUI(profileC.page, g2User.email);
    const contactsListA = await profileA.page.evaluate(
      async ({ api, token }) => {
        const r = await fetch(`${api}/contacts/`, { headers: { Authorization: `Bearer ${token}` } });
        return r.json();
      },
      { api: API_URL, token: resToken }
    );
    const contactId = contactsListA[0].id;
    const g2Token = await profileC.page.evaluate(() => localStorage.getItem('access_token'));
    const g2TryAccept = await profileC.page.evaluate(
      async ({ api, token, cid }) => {
        const r = await fetch(`${api}/guardian/requests/${cid}/accept/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        return r.status;
      },
      { api: API_URL, token: g2Token, cid: contactId }
    );
    if (g2TryAccept !== 404) throw new Error(`Expected 404 for wrong guardian accept, got ${g2TryAccept}`);

    const selfVerifyStatus = await profileA.page.evaluate(
      async ({ api, token, cid }) => {
        const r = await fetch(`${api}/contacts/${cid}/verify/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ token: 'fake' }),
        });
        return r.status;
      },
      { api: API_URL, token: resToken, cid: contactId }
    );
    if (selfVerifyStatus !== 410) throw new Error(`Expected 410 on self-verify, got ${selfVerifyStatus}`);
    resultsLog.push('Other guardian accept returned 404; resident self-verify returned 410 Gone.');

    // Guardian 1 clicks Accept in UI
    await clickButtonContaining(profileB.page, 'Accept');
    await waitForText(profileB.page, 'Kavya Nair');
    await delay(800);

    // Resident reloads contacts -> Verified chip & no warning
    await profileA.page.reload({ waitUntil: 'networkidle0' });
    await waitForText(profileA.page, 'Verified');
    const stillWarn = await profileA.page.evaluate(() =>
      document.body.innerText.includes('No verified guardian yet')
    );
    if (stillWarn) throw new Error('No verified guardian warning should be gone after acceptance!');
    await snap(profileA.page, 'guardian-verified-1280.png');
    resultsLog.push('Guardian accepted in UI; resident sees Verified chip & warning disappeared.');

    // Resident raises post-accept SOS -> Guardian receives notification & can view incident
    const postSosResp = await profileA.page.evaluate(
      async ({ api, token }) => {
        const r = await fetch(`${api}/incidents/sos/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ emergency_type: 'fire', description: 'After accept SOS' }),
        });
        return { status: r.status, data: await r.json() };
      },
      { api: API_URL, token: resToken }
    );
    if (postSosResp.status !== 201) throw new Error('Post-accept SOS failed');
    const postSosId = postSosResp.data.id;

    await profileB.page.goto(`${BASE_URL}/incidents/${postSosId}`, { waitUntil: 'networkidle0' });
    await waitForText(profileB.page, `Incident #${postSosId}`);
    resultsLog.push(`After acceptance, Guardian opened post-accept SOS Incident #${postSosId}.`);

    // 4. Remove -> Add by formatted phone -> Resend -> Decline -> Request again -> Cancel -> Re-add (no 500s)
    console.log('--- 4. Phone lookup, Decline, Request again, Cancel & Re-add ---');
    await profileA.page.goto(`${BASE_URL}/resident/contacts`, { waitUntil: 'networkidle0' });
    await clickButtonContaining(profileA.page, 'Remove');
    await waitForText(profileA.page, 'Your Safety Circle has no contacts yet');

    // Add via formatted phone (+91 XXXXX XXXXX)
    await clickButtonContaining(profileA.page, 'Add Contact / Guardian');
    await profileA.page.waitForSelector('#lookup-identifier');
    await setInput(profileA.page, '#lookup-identifier', g1PhoneFormatted);
    await clickButtonContaining(profileA.page, 'Find', '[role="dialog"]');
    await waitForText(profileA.page, 'Rohan Nair');
    await clickButtonContaining(profileA.page, 'Send request', '[role="dialog"]');
    await waitForText(profileA.page, 'Pending (waiting for guardian)');
    resultsLog.push(`Added guardian using formatted phone "${g1PhoneFormatted}".`);

    // Guardian declines in UI
    await profileB.page.goto(`${BASE_URL}/guardian/alerts`, { waitUntil: 'networkidle0' });
    await waitForText(profileB.page, 'Kavya Nair');
    await clickButtonContaining(profileB.page, 'Decline');
    await delay(700);

    // Resident sees Declined & clicks Request again
    await profileA.page.reload({ waitUntil: 'networkidle0' });
    await waitForText(profileA.page, 'Declined');
    await clickButtonContaining(profileA.page, 'Request again');
    await waitForText(profileA.page, 'Pending (waiting for guardian)');

    // Resident clicks Cancel request -> slot freed -> re-add guardian 2 cleanly
    await clickButtonContaining(profileA.page, 'Cancel request');
    await waitForText(profileA.page, 'Your Safety Circle has no contacts yet');
    await clickButtonContaining(profileA.page, 'Add Contact / Guardian');
    await profileA.page.waitForSelector('#lookup-identifier');
    await setInput(profileA.page, '#lookup-identifier', g2User.username);
    await clickButtonContaining(profileA.page, 'Find', '[role="dialog"]');
    await waitForText(profileA.page, 'Ananya Nair');
    await clickButtonContaining(profileA.page, 'Send request', '[role="dialog"]');
    await waitForText(profileA.page, 'Pending (waiting for guardian)');
    resultsLog.push('Decline, Request again, Cancel, Remove & Re-add primary guardian all succeeded with zero 500 errors.');

    const allErrors = [...profileA.errors, ...profileB.errors, ...profileC.errors];
    if (allErrors.length > 0) {
      throw new Error(`Browser console / 5xx errors:\n${allErrors.join('\n')}`);
    }

    console.log('ALL GUARDIAN END-TO-END CHECKS PASSED:');
    for (const line of resultsLog) console.log('  *', line);
  } finally {
    await profileA.ctx.close().catch(() => {});
    await profileB.ctx.close().catch(() => {});
    await profileC.ctx.close().catch(() => {});
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Guardian E2E FAILED:', err);
  process.exit(1);
});

