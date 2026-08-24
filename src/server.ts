import 'dotenv/config';
import { createApp } from './app';
import { profileStore } from './profiles/store';
import { startSwiggyReloginReminderCron } from './swiggy/relogin_reminder';

const rawPort = process.env.PORT || '3000';
const port = Number(rawPort);

async function startServer(): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT: ${rawPort}`);
  }

  await profileStore.initialize();
  const app = createApp();
  app.listen(port, () => {
    console.log(`Swiggy WhatsApp Agent running at http://localhost:${port}`);
    console.log(`Household desk: http://localhost:${port}/`);
    console.log(`Meta webhook: http://localhost:${port}/webhook/whatsapp`);
    startSwiggyReloginReminderCron();
  });
}

startServer().catch((error: unknown) => {
  console.error('Server failed to start:', error);
  process.exitCode = 1;
});
