import type { Settings } from '@student-os/core';

const ACCENTS: Record<string, { light: string; dark: string }> = {
  indigo: { light: '#4f46e5', dark: '#818cf8' },
  blue: { light: '#2563eb', dark: '#60a5fa' },
  teal: { light: '#0f766e', dark: '#2dd4bf' },
  rose: { light: '#be123c', dark: '#fb7185' },
  amber: { light: '#b45309', dark: '#fbbf24' },
  violet: { light: '#7c3aed', dark: '#a78bfa' },
};
export const ACCENT_NAMES = Object.keys(ACCENTS);

export function applyTheme(theme: Settings['theme'], accent: string) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  const a = ACCENTS[accent] ?? ACCENTS.indigo!;
  root.style.setProperty('--accent', dark ? a.dark : a.light);
  try {
    localStorage.setItem('sos-theme', theme);
  } catch {
    // storage blocked: theme still applies for this session
  }
}

export function accentSwatch(name: string) {
  return (ACCENTS[name] ?? ACCENTS.indigo!).light;
}
