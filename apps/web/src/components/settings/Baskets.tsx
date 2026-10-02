/**
 * Baskets: groups of subjects that share a calendar (College, Coaching, …).
 * A basket's own holidays add to the global ones; its term dates and
 * attendance thresholds replace the global defaults when set.
 */
import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Basket, Settings } from '@student-os/core';
import { SUBJECT_COLORS } from '../../lib/actions';
import { db } from '../../lib/db';
import { useAll } from '../../lib/hooks';
import { create, remove, sortBaskets, update } from '../../lib/repo';
import { toast } from '../../lib/store';
import { Button, Chip, Field, Input, Modal } from '../ui';
import { SettingRow, SettingsGroup } from './SettingsUI';

const SUGGESTIONS = [
  { name: 'College', icon: '🏫' },
  { name: 'Coaching', icon: '📘' },
  { name: 'School', icon: '🎒' },
  { name: 'Tuition', icon: '✏️' },
];
const ICONS = ['📚', '🏫', '📘', '🎒', '✏️', '🎵', '💻', '🧪', '⚽', '🎨'];

const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** One-line description of a basket's own rules, for list rows. */
export function basketSummary(b: Basket, subjectCount: number): string {
  return [
    `${subjectCount} subject${subjectCount === 1 ? '' : 's'}`,
    b.termStart || b.termEnd ? `term ${b.termStart ? fmtDate(b.termStart) : '…'} – ${b.termEnd ? fmtDate(b.termEnd) : '…'}` : null,
    b.minAttendance !== null ? `min ${b.minAttendance}%` : null,
    b.holidays.length ? `${b.holidays.length} own holiday${b.holidays.length === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function BasketsSection({ s }: { s: Settings }) {
  const baskets = sortBaskets(useAll('basket') ?? []);
  const subjects = useAll('subject') ?? [];
  const [editing, setEditing] = useState<Basket | { name: string; icon: string } | null>(null);
  const suggestions = SUGGESTIONS.filter((x) => !baskets.some((b) => b.name.toLowerCase() === x.name.toLowerCase()));

  async function del(b: Basket) {
    const members = subjects.filter((x) => x.basketId === b.id);
    const target = baskets.find((x) => x.id !== b.id);
    if (members.length && !target) {
      toast('Every subject needs a basket. Add another basket first, then delete this one.', 'error');
      return;
    }
    const moving = members.length ? ` Its ${members.length} subject${members.length === 1 ? '' : 's'} will move to ${target!.name}.` : '';
    if (!confirm(`Delete the ${b.name} basket?${moving}`)) return;
    for (const x of members) await update('subject', x.id, { basketId: target!.id });
    await remove('basket', b.id);
    toast(`${b.name} basket deleted`, 'info');
  }

  return (
    <div className="space-y-6">
      <SettingsGroup
        title="Your baskets"
        footer="A basket groups subjects taught in one place, like college or coaching. Its holidays, term dates and attendance rules apply only to its subjects; anything left blank follows the rules for every basket."
      >
        {baskets.length === 0 && <SettingRow label="No baskets yet" description="All subjects follow your global semester, holidays and attendance rules." />}
        {baskets.map((b) => (
          <SettingRow
            key={b.id}
            label={
              <span className="flex items-center gap-2">
                <span aria-hidden>{b.icon}</span>
                {b.name}
              </span>
            }
            description={basketSummary(b, subjects.filter((x) => x.basketId === b.id).length)}
          >
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" aria-label={`Edit ${b.name}`} onClick={() => setEditing(b)}>
                <Pencil className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Delete ${b.name}`} onClick={() => void del(b)}>
                <Trash2 className="size-4" />
              </Button>
            </span>
          </SettingRow>
        ))}
        <SettingRow label="Add a basket" stacked>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((x) => (
              <Chip key={x.name} onClick={() => setEditing(x)}>
                <span aria-hidden>{x.icon}</span> {x.name}
              </Chip>
            ))}
            <Chip onClick={() => setEditing({ name: '', icon: '📚' })}>
              <Plus className="size-4" /> Custom
            </Chip>
          </div>
        </SettingRow>
      </SettingsGroup>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing && 'id' in editing ? `Edit ${editing.name}` : 'New basket'}>
        {editing && <BasketForm initial={editing} settings={s} order={baskets.length} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function BasketForm({ initial, settings, order, onDone }: { initial: Basket | { name: string; icon: string }; settings: Settings; order: number; onDone: () => void }) {
  const existing = 'id' in initial ? initial : null;
  const subjects = (useAll('subject') ?? []).sort((a, b) => a.name.localeCompare(b.name));
  const [name, setName] = useState(initial.name);
  const [icon, setIcon] = useState(initial.icon);
  const [color, setColor] = useState(existing?.color ?? SUBJECT_COLORS[order % SUBJECT_COLORS.length]!);
  const [termStart, setTermStart] = useState(existing?.termStart ?? '');
  const [termEnd, setTermEnd] = useState(existing?.termEnd ?? '');
  const [minAttendance, setMin] = useState(existing?.minAttendance?.toString() ?? '');
  const [targetAttendance, setTarget] = useState(existing?.targetAttendance?.toString() ?? '');
  const [holidays, setHolidays] = useState<string[]>(existing?.holidays ?? []);
  const [holiday, setHoliday] = useState('');
  const [members, setMembers] = useState<Set<string>>(() => new Set(existing ? subjects.filter((x) => x.basketId === existing.id).map((x) => x.id) : []));
  const [busy, setBusy] = useState(false);
  // useAll is async: once subjects load, seed membership for an existing basket.
  const [seeded, setSeeded] = useState(subjects.length > 0);
  if (!seeded && subjects.length > 0) {
    setSeeded(true);
    if (existing) setMembers(new Set(subjects.filter((x) => x.basketId === existing.id).map((x) => x.id)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const data = {
        name: name.trim(),
        icon: icon || '📚',
        color,
        termStart: termStart || null,
        termEnd: termEnd || null,
        minAttendance: minAttendance ? Number(minAttendance) : null,
        targetAttendance: targetAttendance ? Number(targetAttendance) : null,
        holidays: [...new Set(holidays)].sort(),
      };
      const basket = existing ? await update('basket', existing.id, data) : await create('basket', { ...data, order });
      // Move subjects in or out of this basket. Re-read so a subject edited meanwhile isn't clobbered.
      for (const subject of (await db.entity('subject').toArray()).filter((x) => !x.deletedAt)) {
        const inBasket = subject.basketId === basket.id;
        if (members.has(subject.id) && !inBasket) await update('subject', subject.id, { basketId: basket.id });
      }
      toast(existing ? 'Basket updated' : `${data.name} basket added`, 'success');
      onDone();
    } catch (err) {
      console.error(err);
      toast("Couldn't save. Check the fields and try again.", 'error');
    } finally {
      setBusy(false);
    }
  }

  const otherBasket = (basketId: string | null) => !!basketId && basketId !== existing?.id;
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex gap-2">
        <Field label="Icon" className="w-20">
          <Input value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 4))} className="text-center text-lg" aria-label="Icon" />
        </Field>
        <Field label="Name" className="flex-1">
          <Input autoFocus={!initial.name} value={name} onChange={(e) => setName(e.target.value)} placeholder="College" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-1">
        {ICONS.map((i) => (
          <button
            key={i}
            type="button"
            aria-label={`Icon ${i}`}
            aria-pressed={icon === i}
            onClick={() => setIcon(i)}
            className="size-9 rounded-lg text-lg hover:bg-surface-2 aria-pressed:bg-accent-soft"
          >
            {i}
          </button>
        ))}
      </div>
      <Field label="Colour" group>
        <div className="flex flex-wrap gap-2">
          {SUBJECT_COLORS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setColor(c)}
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              className="size-7 rounded-full ring-offset-2 ring-offset-surface aria-pressed:ring-2 aria-pressed:ring-ink"
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>

      <Field
        label="Subjects in this basket"
        group
        hint={
          subjects.length ? 'Each subject is in exactly one basket. To take a subject out, add it to another basket.' : 'Add subjects first, or pick this basket when you add one.'
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {subjects.map((x) => {
            const on = members.has(x.id);
            // Already in this basket: it can only leave by joining another one.
            const locked = !!existing && x.basketId === existing.id;
            return (
              <Chip
                key={x.id}
                selected={on}
                onClick={() =>
                  !locked &&
                  setMembers((m) => {
                    const next = new Set(m);
                    if (on) next.delete(x.id);
                    else next.add(x.id);
                    return next;
                  })
                }
              >
                {x.name}
                {!on && otherBasket(x.basketId) && <span className="text-xs text-muted">(moves)</span>}
              </Chip>
            );
          })}
        </div>
      </Field>

      <div className="space-y-2 rounded-xl border border-line p-3">
        <p className="text-xs text-ink-2">Rules for this basket only. Leave blank to follow the rules for every basket.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Term starts" hint={!termStart && settings.semesterStart ? `Global: ${fmtDate(settings.semesterStart)}` : undefined}>
            <Input type="date" value={termStart} onChange={(e) => setTermStart(e.target.value)} />
          </Field>
          <Field label="Term ends" hint={!termEnd && settings.semesterEnd ? `Global: ${fmtDate(settings.semesterEnd)}` : undefined}>
            <Input type="date" value={termEnd} min={termStart || undefined} onChange={(e) => setTermEnd(e.target.value)} />
          </Field>
          <Field label="Minimum attendance %" hint={`Global: ${settings.minAttendance}%`}>
            <Input type="number" min={0} max={100} value={minAttendance} onChange={(e) => setMin(e.target.value)} />
          </Field>
          <Field label="Target attendance %" hint={`Global: ${settings.targetAttendance}%`}>
            <Input type="number" min={0} max={100} value={targetAttendance} onChange={(e) => setTarget(e.target.value)} />
          </Field>
        </div>
        <Field
          label="Holidays for this basket"
          group
          hint={
            settings.holidays.length ? `Plus ${settings.holidays.length} holiday${settings.holidays.length === 1 ? '' : 's'} for every basket (Semester & holidays).` : undefined
          }
        >
          <div className="flex gap-2">
            <Input type="date" aria-label="Basket holiday date" value={holiday} onChange={(e) => setHoliday(e.target.value)} className="flex-1" />
            <Button
              type="button"
              variant="secondary"
              disabled={!holiday}
              onClick={() => {
                setHolidays((h) => [...new Set([...h, holiday])].sort());
                setHoliday('');
              }}
            >
              Add
            </Button>
          </div>
          {holidays.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {holidays.map((h) => (
                <Chip key={h} selected onClick={() => setHolidays((all) => all.filter((x) => x !== h))}>
                  {fmtDate(h)} <Trash2 className="size-3.5" aria-label="Remove" />
                </Chip>
              ))}
            </div>
          )}
        </Field>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
          {existing ? 'Save' : 'Add basket'}
        </Button>
      </div>
    </form>
  );
}
