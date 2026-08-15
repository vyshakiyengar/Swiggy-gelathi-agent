import { swiggyAuthService } from './auth';
import { whatsAppCloudApiService } from '../whatsapp/cloud_api';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // check every 6 hours
const REMIND_WHEN_LESS_THAN_MS = 48 * 60 * 60 * 1000; // remind once <48h of validity remain
const MIN_GAP_BETWEEN_REMINDERS_MS = 24 * 60 * 60 * 1000; // never remind more than once/day

const REMINDER_NUMBERS = (process.env.SWIGGY_RELOGIN_REMINDER_NUMBERS || '919902383866,917259140866').split(',');

let lastReminderSentAt = 0;

async function sendReminderIfDue() {
  const status = swiggyAuthService.getSessionStatus();
  const expiresAtMs = status.expiresAt ? new Date(status.expiresAt).getTime() : 0;
  const remainingMs = expiresAtMs - Date.now();

  const isDue = !status.valid || remainingMs < REMIND_WHEN_LESS_THAN_MS;
  const recentlyReminded = Date.now() - lastReminderSentAt < MIN_GAP_BETWEEN_REMINDERS_MS;

  if (!isDue || recentlyReminded) return;

  const link = swiggyAuthService.generateAuthorizeUrl();
  const message =
    `🛒 *Grocery Agent: Swiggy relink needed*\n\n` +
    `The grocery ordering session ${status.valid ? 'is about to expire' : 'has expired'}. Tap this link and approve to keep ordering working:\n\n` +
    `${link}\n\n` +
    `Takes a few seconds - no laptop or app needed.`;

  for (const number of REMINDER_NUMBERS) {
    try {
      await whatsAppCloudApiService.sendTextMessage(number.trim(), message);
      console.log(`📤 Sent Swiggy relogin reminder to ${number.trim()}`);
    } catch (err: any) {
      console.error(`❌ Failed to send Swiggy relogin reminder to ${number.trim()}:`, err.response?.data || err.message);
    }
  }

  lastReminderSentAt = Date.now();
}

export function startSwiggyReloginReminderCron() {
  // Run once shortly after boot (catches the case where the session was already stale when the
  // process started/restarted), then on a fixed interval afterward.
  setTimeout(sendReminderIfDue, 60 * 1000);
  setInterval(sendReminderIfDue, CHECK_INTERVAL_MS);
  console.log('⏰ Swiggy relogin reminder cron started (checks every 6h, reminds when <48h of session validity remain).');
}
