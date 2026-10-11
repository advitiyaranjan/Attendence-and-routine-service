import { describe, expect, it } from 'vitest';
import { currentMeal, mealEmoji, settingsSchema } from './index';

const mess = settingsSchema.shape.mess.parse({
  meals: [
    { name: 'Breakfast', start: '07:30', end: '09:30', menu: ['Poha', 'Idli, Sambhar', '', '', '', '', ''] },
    { name: 'Lunch', start: '12:45', end: '14:30', menu: ['Chhole Bhature', 'Aloo Matar', '', '', '', '', ''] },
  ],
});
const at = (h: number, m = 0) => h * 60 + m;

describe('mess menu', () => {
  it('shows a meal only during its serving window', () => {
    expect(currentMeal(mess, 1, at(7, 30))).toMatchObject({ meal: { name: 'Breakfast' }, items: 'Idli, Sambhar' });
    expect(currentMeal(mess, 1, at(9, 29))?.meal.name).toBe('Breakfast');
    expect(currentMeal(mess, 1, at(9, 30))).toBeNull();
    expect(currentMeal(mess, 1, at(13))).toMatchObject({ meal: { name: 'Lunch' }, items: 'Aloo Matar' });
    expect(currentMeal(mess, 0, at(13))?.items).toBe('Chhole Bhature');
  });

  it('shows nothing when a day has no menu or the menu is turned off', () => {
    expect(currentMeal(mess, 2, at(8))).toBeNull();
    expect(currentMeal({ ...mess, enabled: false }, 1, at(8))).toBeNull();
  });

  it('defaults to no meals', () => {
    expect(settingsSchema.shape.mess.parse(undefined)).toEqual({ enabled: true, meals: [] });
    expect(mealEmoji('Lunch')).toBe('🍛');
  });
});
