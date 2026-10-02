import { createApp } from './app';
import { env } from './env';
import { prisma } from './db';
import { PushScheduler } from './modules/push/scheduler';
import { WebPushSender } from './modules/push/sender';

const pushSender = new WebPushSender();
const app = createApp({ pushSender });
const scheduler = new PushScheduler(prisma, pushSender);

const server = app.listen(env.PORT, () => {
  console.log(`Student OS API listening on http://localhost:${env.PORT}`);
  if (!env.GEMINI_API_KEY) console.warn('GEMINI_API_KEY not set — AI features will report as unavailable.');
  if (!pushSender.enabled) console.warn('VAPID keys not set — push notifications disabled (in-app reminders still work).');
  else if (env.PUSH_SCHEDULER) scheduler.start();
});

async function shutdown() {
  scheduler.stop();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
