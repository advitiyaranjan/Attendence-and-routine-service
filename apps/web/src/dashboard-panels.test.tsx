import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { subjectSchema, summarizeSubject, type AttendanceOverview, type SubjectAttendance } from '@student-os/core';
import { AttendancePanel, ScheduleTimeline, type TimelineItem } from './components/DashboardPanels';

function subject(name: string, present: number, min: number): SubjectAttendance {
  const thresholds = { min, target: min, safe: min };
  return {
    subject: subjectSchema.parse({ id: name, name, createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z', deviceId: 'test', deletedAt: null, version: 0, syncStatus: 'synced' }),
    basket: null,
    thresholds,
    summary: summarizeSubject({ present, absent: 100 - present, conducted: 100, cancelled: 0, unmarked: 0 }, thresholds, null),
  };
}

describe('dashboard attendance presentation', () => {
  it('prioritizes threshold risk even when a safe subject has a lower percentage', () => {
    const attendance: AttendanceOverview = {
      subjects: [subject('Safe subject', 40, 30), subject('Strict threshold', 90, 95), subject('Third subject', 100, 75), subject('Fourth subject', 100, 75)],
      overall: { present: 330, conducted: 400, percent: 82.5, unmarked: 0 }, unmarked: [],
    };
    const html = renderToStaticMarkup(<MemoryRouter><AttendancePanel attendance={attendance} /></MemoryRouter>);
    expect(html.indexOf('Strict threshold')).toBeLessThan(html.indexOf('Safe subject'));
    expect(html).toContain('1 subject needs attention');
    expect(html).toContain('View all 4 subjects');
    expect(html).not.toContain('Fourth subject');
    expect(html).toContain('aria-valuenow="82.5"');
  });

  it('keeps unknown attendance unknown rather than reporting zero percent', () => {
    const attendance: AttendanceOverview = { subjects: [], overall: { present: 0, conducted: 0, percent: null, unmarked: 0 }, unmarked: [] };
    const html = renderToStaticMarkup(<MemoryRouter><AttendancePanel attendance={attendance} /></MemoryRouter>);
    expect(html).toContain('Mark your first class');
    expect(html).not.toContain('aria-valuenow');
  });
});

describe('dashboard timeline presentation', () => {
  const ended: TimelineItem = { key: 'past', start: '09:00', complete: false, past: true, active: false, category: 'College class', status: 'Ended · needs marking', node: <button>Mark attendance</button> };

  it('keeps elapsed, unmarked classes actionable without calling them completed', () => {
    const html = renderToStaticMarkup(<ScheduleTimeline items={[ended]} />);
    expect(html).toContain('Ended · needs marking');
    expect(html).toContain('Mark attendance');
    expect(html).not.toContain('Completed');
  });

  it('focuses on upcoming sessions but exposes a full schedule when history is hidden', () => {
    const upcoming: TimelineItem = { key: 'next', start: '14:00', complete: false, past: false, active: false, category: 'Independent study', node: <span>Study algorithms</span> };
    const html = renderToStaticMarkup(<ScheduleTimeline items={[ended, upcoming]} />);
    expect(html).toContain('Study algorithms');
    expect(html).not.toContain('Mark attendance');
    expect(html).toContain('View full schedule · 2 sessions');
    expect(html).toContain('aria-expanded="false"');
  });
});
