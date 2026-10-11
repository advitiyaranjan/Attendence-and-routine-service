/** One-time local data migrations, run at start-up. */
import { db, kvGet, kvSet } from './db';
import { SETTINGS_ID, saveSettings } from './repo';

/**
 * AI Pilot may now propose any change (subjects, settings, deletions, bulk edits);
 * every change still needs the student's confirmation and can be undone.
 * Existing installs saved the old conservative defaults, so switch them on once.
 * Students can still turn individual permissions off in Settings → AI permissions.
 */
async function aiPermissionsV2() {
  const key = 'migration.aiPermissionsV2';
  if (await kvGet<boolean>(key)) return;
  const settings = await db.entity('settings').get(SETTINGS_ID);
  if (settings) {
    await saveSettings({
      aiPermissions: { ...settings.aiPermissions, bulkChanges: true, manageSubjects: true, modifySettings: true },
    });
  }
  await kvSet(key, true);
}

/**
 * The Goals home card is new. Students who saved their own card layout before it
 * existed would never see it, so add it once after "Today's priorities".
 */
async function goalsHomeCard() {
  const key = 'migration.goalsHomeCard';
  if (await kvGet<boolean>(key)) return;
  const settings = await db.entity('settings').get(SETTINGS_ID);
  // Not there yet (new device before its first sync): try again next launch.
  if (!settings) return;
  const sections = settings.app?.homeSections;
  if (sections && !sections.includes('goals')) {
    const at = sections.indexOf('priorities');
    const next = [...sections];
    next.splice(at === -1 ? next.length : at + 1, 0, 'goals');
    await saveSettings({ app: { ...settings.app, homeSections: next } });
  }
  await kvSet(key, true);
}

export async function runMigrations() {
  for (const m of [aiPermissionsV2, goalsHomeCard]) {
    try {
      await m();
    } catch (e) {
      console.warn('migration failed', e);
    }
  }
}
