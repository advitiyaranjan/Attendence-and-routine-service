import type { Settings } from '@student-os/core';

const ACCENTS: Record<string, { light: string; dark: string }> = {
  indigo: { light: '#4f46e5', dark: '#818cf8' },
  blue: { light: '#3266c6', dark: '#6ea8fe' },
  cyan: { light: '#0e7490', dark: '#22d3ee' },
  teal: { light: '#0f766e', dark: '#2dd4bf' },
  emerald: { light: '#047857', dark: '#34d399' },
  amber: { light: '#b45309', dark: '#fbbf24' },
  orange: { light: '#c2410c', dark: '#fb923c' },
  rose: { light: '#be123c', dark: '#fb7185' },
  pink: { light: '#be185d', dark: '#f472b6' },
  violet: { light: '#7c3aed', dark: '#a78bfa' },
  slate: { light: '#334155', dark: '#cbd5e1' },
};
export const ACCENT_NAMES = Object.keys(ACCENTS);

const HEX = /^#[0-9a-f]{6}$/i;
export const isCustomAccent = (accent: string) => HEX.test(accent);

/** Relative luminance (0 black – 1 white) of a #rrggbb colour. */
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Accent colour and the text colour that stays readable on it, for a named or custom (#rrggbb) accent. */
function resolveAccent(accent: string, dark: boolean): { accent: string; ink: string } {
  if (isCustomAccent(accent)) {
    // A custom colour is used as picked in light mode and lightened a little in dark mode.
    const value = dark ? `color-mix(in srgb, ${accent} 75%, white)` : accent;
    const lum = luminance(accent);
    const ink = dark ? '#0b0c0f' : lum > 0.45 ? '#0f1115' : '#ffffff';
    return { accent: value, ink };
  }
  const a = ACCENTS[accent] ?? ACCENTS.indigo!;
  return { accent: dark ? a.dark : a.light, ink: dark ? '#0b0c0f' : '#ffffff' };
}

export interface ThemePrefs {
  theme: Settings['theme'];
  accent: string;
  density?: Settings['density'];
  reduceMotion?: boolean;
}

export function applyTheme({ theme, accent, density = 'comfortable', reduceMotion = false }: ThemePrefs) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.classList.toggle('compact', density === 'compact');
  root.classList.toggle('reduce-motion', reduceMotion);
  const a = resolveAccent(accent, dark);
  root.style.setProperty('--accent', a.accent);
  root.style.setProperty('--accent-ink', a.ink);
  try {
    localStorage.setItem('sos-theme', theme);
    localStorage.setItem('sos-density', density);
  } catch {
    // storage blocked: theme still applies for this session
  }
}

export function accentSwatch(name: string) {
  return isCustomAccent(name) ? name : (ACCENTS[name] ?? ACCENTS.indigo!).light;
}

/** True when animations should be skipped (system setting or the in-app switch). */
export function motionReduced() {
  return document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
}
