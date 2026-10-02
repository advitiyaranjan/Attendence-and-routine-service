import { describe, expect, it } from 'vitest';
import { inAppHref, linkifySettings } from './lib/copilot/links';

const O = 'http://app.local';

describe('AI Pilot reply links', () => {
  it('normalises settings links to the section route', () => {
    expect(inAppHref('/settings/ai', O)).toBe('/settings/ai');
    expect(inAppHref('/settings/ai-pilot', O)).toBe('/settings/ai');
    expect(inAppHref('settings#notifications', O)).toBe('/settings/notifications');
    expect(inAppHref('/settings/Privacy%20%26%20data', O)).toBe('/settings/data');
    expect(inAppHref(`${O}/settings/baskets`, O)).toBe('/settings/baskets');
    expect(inAppHref('/settings/nope', O)).toBe('/settings');
    expect(inAppHref('/settings', O)).toBe('/settings');
  });

  it('keeps other app routes and leaves external links alone', () => {
    expect(inAppHref('/review?tab=weekly', O)).toBe('/review?tab=weekly');
    expect(inAppHref('https://example.com/settings/ai', O)).toBeNull();
    expect(inAppHref('mailto:a@b.c', O)).toBeNull();
  });

  it('links plain "Settings → section" mentions', () => {
    expect(linkifySettings('Change it in Settings → AI Pilot.')).toBe('Change it in [Settings → AI Pilot](/settings/ai).');
    expect(linkifySettings('Open **Settings > Baskets**')).toBe('Open **[Settings > Baskets](/settings/baskets)**');
    expect(linkifySettings('See Settings -> Semester & holidays')).toBe('See [Settings -> Semester & holidays](/settings/academic)');
  });

  it('does not touch existing links or code', () => {
    const md = 'Go to [Settings → AI Pilot](/settings/ai) or `Settings → Baskets`.';
    expect(linkifySettings(md)).toBe(md);
  });
});
