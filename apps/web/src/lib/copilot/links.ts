/**
 * Links in AI Pilot replies. The model may write a settings link in several
 * shapes ("/settings/ai", "settings#notifications", "/settings/ai-pilot") or
 * just name the place ("Settings → AI Pilot"); all of them resolve to the
 * in-app route for that Settings section.
 */

/** Settings section ids (see pages/Settings.tsx) with the names the model may use for them. */
const SETTINGS_SECTIONS: Array<{ id: string; names: string[] }> = [
  { id: 'profile', names: ['Profile'] },
  { id: 'account', names: ['Account & sync', 'Account and sync', 'Account', 'Sync'] },
  { id: 'baskets', names: ['Baskets', 'Basket'] },
  { id: 'academic', names: ['Semester & holidays', 'Semester and holidays', 'Semester', 'Holidays', 'Academic'] },
  { id: 'attendance', names: ['Attendance'] },
  { id: 'study', names: ['Study & revision', 'Study and revision', 'Study', 'Revision'] },
  { id: 'notifications', names: ['Notifications', 'Reminders'] },
  { id: 'ai', names: ['AI Pilot', 'AI Power', 'AI permissions', 'AI'] },
  { id: 'appearance', names: ['Appearance', 'Theme'] },
  { id: 'data', names: ['Privacy & data', 'Privacy and data', 'Privacy', 'Data'] },
];

const slug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

const BY_SLUG = new Map<string, string>();
for (const { id, names } of SETTINGS_SECTIONS) {
  BY_SLUG.set(slug(id), id);
  for (const n of names) BY_SLUG.set(slug(n), id);
}
BY_SLUG.set('aipilot', 'ai');

/** The Settings section id for a name or slug the model used, if any. */
export function settingsSection(name: string): string | undefined {
  return BY_SLUG.get(slug(name));
}

/**
 * The in-app route for a link in a reply, or null when it points outside the app.
 * Settings links are normalised to /settings/<section>.
 */
export function inAppHref(href: string, origin = typeof window === 'undefined' ? 'http://app.local' : window.location.origin): string | null {
  const raw = href.trim();
  if (!raw || /^(mailto|tel):/i.test(raw)) return null;
  let url: URL;
  try {
    // "settings/ai" and "settings#ai" are meant from the app root, not relative to the current page.
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('/') || raw.startsWith('#') ? raw : `/${raw}`, origin + '/');
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0]?.toLowerCase() === 'settings') {
    const name = parts[1] ?? url.hash.slice(1);
    const id = name ? settingsSection(decodeURIComponent(name)) : undefined;
    return id ? `/settings/${id}` : '/settings';
  }
  return url.pathname + url.search + url.hash;
}

const NAMES = SETTINGS_SECTIONS.flatMap((x) => x.names)
  .sort((a, b) => b.length - a.length)
  .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
// "Settings → AI Pilot", "Settings > Baskets", "Settings -> Notifications", optionally **bold**.
const MENTION = new RegExp(`(\\*\\*)?\\bSettings\\s*(?:→|->|>|›|»)\\s*(${NAMES.join('|')})\\b(\\*\\*)?`, 'gi');

/**
 * Turns plain "Settings → <section>" mentions into markdown links, leaving
 * text that is already a link (or code) alone.
 */
export function linkifySettings(markdown: string): string {
  // Split out existing links, inline code and code blocks so they're never rewritten.
  return markdown
    .split(/(```[\s\S]*?```|`[^`]*`|\[[^\]]*\]\([^)]*\))/g)
    .map((chunk, i) =>
      i % 2 === 1
        ? chunk
        : chunk.replace(MENTION, (whole, open: string | undefined, name: string, close: string | undefined) => {
            const id = settingsSection(name);
            if (!id) return whole;
            const label = whole.replace(/\*\*/g, '');
            const link = `[${label}](/settings/${id})`;
            return open && close ? `**${link}**` : `${open ?? ''}${link}${close ?? ''}`;
          }),
    )
    .join('');
}
