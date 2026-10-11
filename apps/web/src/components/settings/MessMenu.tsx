/** Mess menu: meals with serving times and a dish list per weekday. Shown only on the home greeting at meal times. */
import { Plus, Trash2 } from 'lucide-react';
import { mealEmoji, type MessMeal, type Settings } from '@student-os/core';
import { Button, Toggle } from '../ui';
import { saveSettings } from '../../lib/repo';
import { SettingBlock, SettingRow, SettingsGroup } from './SettingsUI';

/** Monday first, as on a printed mess chart; values are weekday indexes (0 = Sunday). */
const DAYS: Array<[number, string]> = [
  [1, 'Monday'],
  [2, 'Tuesday'],
  [3, 'Wednesday'],
  [4, 'Thursday'],
  [5, 'Friday'],
  [6, 'Saturday'],
  [0, 'Sunday'],
];

const timeInput = 'h-9 rounded-lg border border-line bg-surface-2 px-2 text-sm text-ink focus:border-accent focus:outline-none';

export function MessSection({ s }: { s: Settings }) {
  const { mess } = s;
  const saveMeals = (meals: MessMeal[]) => void saveSettings({ mess: { ...mess, meals } });
  const setMeal = (i: number, patch: Partial<MessMeal>) => saveMeals(mess.meals.map((m, k) => (k === i ? { ...m, ...patch } : m)));

  return (
    <div className="space-y-6">
      <SettingsGroup footer="Shown only on the Home greeting while a meal is being served. It never appears in your calendar, todos or notifications. To load a new schedule, send AI Pilot a photo of it.">
        <SettingBlock>
          <Toggle checked={mess.enabled} onChange={(v) => void saveSettings({ mess: { ...mess, enabled: v } })} label="Show meals on Home" description="Turn off for holidays or days you eat elsewhere." />
        </SettingBlock>
      </SettingsGroup>

      {mess.meals.map((m, i) => (
        <SettingsGroup key={`${i}-${m.name}`} title={`${mealEmoji(m.name)} ${m.name}`}>
          <SettingRow label="Name">
            <input
              aria-label="Meal name"
              defaultValue={m.name}
              maxLength={40}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== m.name && setMeal(i, { name: e.target.value.trim() })}
              className="h-9 w-40 rounded-lg border border-transparent bg-transparent px-2 text-right text-sm text-ink hover:border-line focus:border-accent focus:bg-surface-2 focus:outline-none"
            />
          </SettingRow>
          <SettingRow label="Served">
            <div className="flex items-center gap-1.5">
              <input type="time" aria-label={`${m.name} start`} className={timeInput} value={m.start} onChange={(e) => e.target.value && e.target.value < m.end && setMeal(i, { start: e.target.value })} />
              <span className="text-muted">–</span>
              <input type="time" aria-label={`${m.name} end`} className={timeInput} value={m.end} onChange={(e) => e.target.value && e.target.value > m.start && setMeal(i, { end: e.target.value })} />
            </div>
          </SettingRow>
          {DAYS.map(([d, label]) => (
            <SettingRow key={d} label={label} stacked>
              <input
                aria-label={`${m.name} on ${label}`}
                defaultValue={m.menu[d]}
                key={m.menu[d]}
                maxLength={300}
                placeholder="Not served"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== m.menu[d]) setMeal(i, { menu: m.menu.map((x, k) => (k === d ? v : x)) });
                }}
                className="h-9 w-full rounded-lg border border-line bg-surface-2 px-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
              />
            </SettingRow>
          ))}
          <div className="flex justify-end px-4 py-2">
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => saveMeals(mess.meals.filter((_, k) => k !== i))}>
              Remove {m.name}
            </Button>
          </div>
        </SettingsGroup>
      ))}

      <Button
        variant="secondary"
        icon={<Plus className="size-4" />}
        onClick={() => {
          const last = mess.meals.at(-1);
          const start = last && last.end < '22:00' ? last.end : '08:00';
          const [h, min] = start.split(':').map(Number);
          const end = `${String(Math.min(23, h! + 1)).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
          saveMeals([...mess.meals, { name: `Meal ${mess.meals.length + 1}`, start, end: end > start ? end : '23:59', menu: ['', '', '', '', '', '', ''] }]);
        }}
      >
        Add meal
      </Button>
    </div>
  );
}
