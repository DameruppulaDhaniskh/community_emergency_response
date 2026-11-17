import { capture } from './capture.js';
import { captureAuthenticated } from './capture-auth.js';
import fs from 'fs';
import path from 'path';

async function run() {
  console.log('--- STARTING VERIFICATION CAPTURES FOR ALL 8 BOARDS ---');
  const outDir = path.resolve('verification-screenshots');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // 1. Login (1280x800)
  console.log('Capturing Board 1: Login...');
  await capture('http://127.0.0.1:5173/login', path.join(outDir, '01-login.png'), 1280, 800);

  // 2. Resident Dashboard (1280x800)
  console.log('Capturing Board 2: Resident Dashboard...');
  await captureAuthenticated('asha@example.com', 'password123', '/resident/home', path.join(outDir, '02-resident-dashboard.png'), 1280, 800);

  // 3. Incident Tracking (1280x800)
  console.log('Capturing Board 3: Incident Tracking...');
  await captureAuthenticated('asha@example.com', 'password123', '/incidents/12', path.join(outDir, '03-incident-tracking.png'), 1280, 800);

  // 4. Profile & Contacts (1280x800)
  console.log('Capturing Board 4: Profile & Contacts...');
  await captureAuthenticated('asha@example.com', 'password123', '/profile', path.join(outDir, '04-profile.png'), 1280, 800);

  // 5. Mobile SOS (390x844)
  console.log('Capturing Board 5: Mobile SOS...');
  await captureAuthenticated('asha@example.com', 'password123', '/resident/home', path.join(outDir, '05-mobile-sos.png'), 390, 844);

  // 6. Notifications (1280x800)
  console.log('Capturing Board 6: Notifications...');
  await captureAuthenticated('asha@example.com', 'password123', '/notifications', path.join(outDir, '06-notifications.png'), 1280, 800);

  // 7. Emergency Contacts (1280x800)
  console.log('Capturing Board 7: Emergency Contacts...');
  await captureAuthenticated('asha@example.com', 'password123', '/resident/contacts', path.join(outDir, '07-emergency-contacts.png'), 1280, 800);

  // 8. Guardian Live Alert (1280x800)
  console.log('Capturing Board 8: Guardian Live Alert...');
  await captureAuthenticated('ravi@example.com', 'password123', '/guardian/alerts', path.join(outDir, '08-guardian-live-alert.png'), 1280, 800);

  console.log('--- ALL 8 BOARDS CAPTURED SUCCESSFULLY ---');
}

run().catch((err) => {
  console.error('Capture all error:', err);
  process.exit(1);
});

