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
      aiPermissions: { ...settings.aiPermissions, deleteData: true, bulkChanges: true, manageSubjects: true, modifySettings: true },
    });
  }
  await kvSet(key, true);
}

export async function runMigrations() {
  try {
    await aiPermissionsV2();
  } catch (e) {
    console.warn('migration failed', e);
  }
}
