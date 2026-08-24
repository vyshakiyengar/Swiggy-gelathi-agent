import { profileStore } from '../profiles/store';
import { whatsAppCloudApiService } from '../whatsapp/cloud_api';
import { swiggyAuthService } from './auth';
import { swiggyMcpService } from './mcp_client';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REMIND_WHEN_LESS_THAN_MS = 48 * 60 * 60 * 1000;
const MIN_GAP_BETWEEN_REMINDERS_MS = 24 * 60 * 60 * 1000;

const lastReminderByProfile = new Map<string, number>();

async function checkProfile(profileId: string): Promise<void> {
  const profile = await profileStore.getProfile(profileId);
  if (!profile?.enabled || !profile.whatsappNumber) return;
  if (!profile.swiggy.connected && !profile.swiggy.expiresAt) return;

  const lastReminder = lastReminderByProfile.get(profile.id) ?? 0;
  if (Date.now() - lastReminder < MIN_GAP_BETWEEN_REMINDERS_MS) return;

  const status = await swiggyAuthService.getSessionStatus(profile.id);
  const expiresAtMs = status.expiresAt ? new Date(status.expiresAt).getTime() : 0;
  const remainingMs = expiresAtMs - Date.now();

  // A real read-only MCP call remains the source of truth; Render restarts make an age heuristic
  // alone unreliable. Keep the live probe as the source of truth after restarts.
  let actuallyBroken = false;
  if (status.valid) {
    try {
      await swiggyMcpService.listTools(profile.id);
    } catch {
      actuallyBroken = true;
    }
  }

  const isDue =
    actuallyBroken || !status.valid || remainingMs < REMIND_WHEN_LESS_THAN_MS;
  if (!isDue) return;

  const link = await swiggyAuthService.generateAuthorizeUrl(profile.id);
  const message =
    `🛒 *${profile.assistantName}: Swiggy relink needed*\n\n` +
    `Your ordering session ${actuallyBroken || !status.valid ? 'has expired' : 'is about to expire'}. ` +
    `Tap this private link and approve to keep ${profile.displayName}'s agent working:\n\n` +
    `${link}\n\nTakes a few seconds. No order will be placed.`;

  try {
    await whatsAppCloudApiService.sendTextMessage(profile.whatsappNumber, message);
    lastReminderByProfile.set(profile.id, Date.now());
    console.log(`Sent Swiggy relink reminder for profile ${profile.id}`);
  } catch (error: any) {
    console.error(
      `Failed to send Swiggy relink reminder for profile ${profile.id}:`,
      error.response?.data || error.message
    );
  }
}

async function sendRemindersIfDue(): Promise<void> {
  const profiles = await profileStore.listProfiles();
  await Promise.all(profiles.map((profile) => checkProfile(profile.id)));
}

export function startSwiggyReloginReminderCron(): void {
  setTimeout(() => {
    void sendRemindersIfDue().catch((error: unknown) => {
      console.error('Swiggy relink reminder check failed:', error);
    });
  }, 60 * 1000);

  setInterval(() => {
    void sendRemindersIfDue().catch((error: unknown) => {
      console.error('Swiggy relink reminder check failed:', error);
    });
  }, CHECK_INTERVAL_MS);

  console.log('Swiggy relink reminder cron started (profile-scoped, every 6h).');
}
