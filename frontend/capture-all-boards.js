import { capture } from './capture.js';
import path from 'path';

const outDir = 'd:\\Infosys project\\Community Emergency Response\\Community Emergency Response\\design-reference\\boards';

const boards = [
  { file: '01-login-rendered.html', name: 'board-1-login.png', w: 1280, h: 800 },
  { file: '02-resident-dashboard-rendered.html', name: 'board-2-resident-dashboard.png', w: 1280, h: 800 },
  { file: '03-incident-tracking-rendered.html', name: 'board-3-incident-tracking.png', w: 1280, h: 800 },
  { file: '04-profile-rendered.html', name: 'board-4-profile.png', w: 1280, h: 800 },
  { file: '05-mobile-sos-rendered.html', name: 'board-5-mobile-sos.png', w: 390, h: 844 },
  { file: '06-notifications-rendered.html', name: 'board-6-notifications.png', w: 1280, h: 800 },
  { file: '07-emergency-contacts-rendered.html', name: 'board-7-emergency-contacts.png', w: 1280, h: 800 },
  { file: '08-guardian-live-alert-rendered.html', name: 'board-8-guardian-live-alert.png', w: 1280, h: 800 },
];

async function run() {
  for (const b of boards) {
    const src = path.join('d:\\Infosys project\\Community Emergency Response\\Community Emergency Response\\design-reference\\unpacked', b.file);
    const dst = path.join(outDir, b.name);
    await capture(src, dst, b.w, b.h);
  }
  console.log('All 8 boards captured successfully!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
