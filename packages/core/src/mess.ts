/**
 * Mess (hostel/canteen) menu: shown only on the home greeting while a meal is being
 * served. Never scheduled anywhere: no calendar entries, tasks or notifications.
 */
import { timeToMinutes } from './dates';
import type { MessMeal, Settings } from './entities';

export interface CurrentMeal {
  meal: MessMeal;
  /** Today's dishes for this meal. */
  items: string;
}

/** The meal being served at `minutes` past midnight on `weekday` (0 = Sunday), if it has a menu today. */
export function currentMeal(mess: Settings['mess'], weekday: number, minutes: number): CurrentMeal | null {
  if (!mess.enabled) return null;
  for (const meal of mess.meals) {
    const start = timeToMinutes(meal.start);
    const end = timeToMinutes(meal.end);
    const items = meal.menu[weekday]?.trim();
    if (items && start <= minutes && minutes < end) return { meal, items };
  }
  return null;
}

/** Emoji for a meal name; 🍽️ when it isn't one of the usual four. */
export function mealEmoji(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('breakfast')) return '☕';
  if (n.includes('lunch')) return '🍛';
  if (n.includes('snack')) return '🥪';
  if (n.includes('dinner')) return '🍲';
  return '🍽️';
}
