import { describe, expect, it } from 'vitest';
import { formatDuration, isoWeek, minutesBetween, mondayOf, parseDate, parseDateTime, parseRange, weekKey } from '../src/shared/dates';
import { addFromLine, addText, completeTask, isOnToday, matchesView, previousWorkday, staleWaiting, standup, summarize } from '../src/shared/logic';
import { normalizeLabel, parseBulk, parseCapture, stripBullet } from '../src/shared/parse';
import { nextOccurrence } from '../src/shared/recur';
import { emptyDoc, newTask } from '../src/shared/types';

const TODAY = '2026-11-08'; // a Sunday

describe('parseDate', () => {
  it.each([
    ['today', '2026-11-08'],
    ['tomorrow', '2026-11-09'],
    ['yesterday', '2026-11-07'],
    ['+3', '2026-11-11'],
    ['-2', '2026-11-06'],
    ['+1w', '2026-11-15'],
    ['mon', '2026-11-09'],
    ['friday', '2026-11-13'],
    ['sun', '2026-11-15'],
    ['last fri', '2026-11-06'],
    ['2026-12-01', '2026-12-01'],
    ['20/11', '2026-11-20'],
    ['5/1/27', '2027-01-05'],
  ])('%s -> %s', (input, expected) => expect(parseDate(input, TODAY)).toBe(expected));

  it.each(['', 'blah', 'mo', '2026-02-30', '32/1'])('rejects %j', (input) => expect(parseDate(input, TODAY)).toBeNull());
});

describe('date-times and ranges', () => {
  it('parses date-times', () => {
    expect(parseDateTime('mon 9:00', TODAY)).toBe('2026-11-09T09:00');
    expect(parseDateTime('14h30', TODAY)).toBe('2026-11-08T14:30');
    expect(parseDateTime('yesterday 14', TODAY)).toBe('2026-11-07T14:00');
    expect(parseDateTime('25:00', TODAY)).toBeNull();
  });
  it('parses ranges', () => {
    expect(parseRange('today 9-11:30', TODAY)).toEqual({ from: '2026-11-08T09:00', to: '2026-11-08T11:30' });
    expect(parseRange('last mon 9:00 - 10h', TODAY)).toEqual({ from: '2026-11-02T09:00', to: '2026-11-02T10:00' });
    expect(parseRange('today 9:00', TODAY)).toBeNull();
  });
  it('computes durations', () => {
    expect(minutesBetween('2026-11-03T09:00', '2026-11-03T11:30')).toBe(150);
    expect(formatDuration(150)).toBe('2h30');
  });
});

describe('weeks', () => {
  it('computes ISO weeks', () => {
    expect(weekKey('2026-11-08')).toBe('2026-W45');
    expect(weekKey('2026-11-02')).toBe('2026-W45');
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
    expect(weekKey('2024-12-30')).toBe('2025-W01');
    expect(mondayOf('2026-11-08')).toBe('2026-11-02');
  });
});

describe('quick capture', () => {
  it('parses all tokens', () => {
    const c = parseCapture('Fix export bug #clientx #p:Apollo PROJ-123 ^fri ~mon * every:fri', TODAY, { p: 'project' });
    expect(c).toMatchObject({
      title: 'Fix export bug PROJ-123',
      labels: ['clientx', 'project:apollo'],
      source: 'jira',
      ref: 'PROJ-123',
      due: '2026-11-13',
      snooze_until: '2026-11-09',
      today: true,
      recur: 'fri',
      errors: [],
    });
  });
  it('explicit source wins over jira detection', () => {
    expect(parseCapture('Reply PROJ-9 @email', TODAY).source).toBe('email');
  });
  it('keeps bad tokens and reports them', () => {
    const c = parseCapture('Call ^someday', TODAY);
    expect(c.title).toBe('Call ^someday');
    expect(c.errors).toHaveLength(1);
  });
  it('takes urls as ref', () => {
    expect(parseCapture('Read https://x.y/z', TODAY)).toMatchObject({ title: 'Read', ref: 'https://x.y/z' });
  });
  it('normalizes labels', () => {
    expect(normalizeLabel('#M:Billing', { m: 'module' })).toBe('module:billing');
  });
});

describe('recurrence', () => {
  it.each([
    ['day', '2026-11-08', '2026-11-09'],
    ['weekday', '2026-11-06', '2026-11-09'],
    ['fri', '2026-11-13', '2026-11-20'],
    ['mon,thu', '2026-11-09', '2026-11-12'],
    ['month:31', '2026-11-08', '2026-11-30'],
    ['month:1', '2026-11-08', '2026-12-01'],
  ])('%s after %s -> %s', (rule, after, expected) => expect(nextOccurrence(rule, after)).toBe(expected));
  it('rejects junk', () => expect(nextOccurrence('blah', TODAY)).toBeNull());
});

describe('task logic', () => {
  it('completing a recurring task creates the next one', () => {
    const doc = emptyDoc();
    doc.tasks.push(newTask({ id: 'a', title: 'Timesheet', recur: 'fri', due: '2026-11-06' }, '2026-11-01T09:00'));
    const next = completeTask(doc, 'a', '2026-11-08');
    expect(doc.tasks[0].done).toBe('2026-11-08');
    expect(next?.due).toBe('2026-11-13');
    expect(next?.done).toBeNull();
    expect(doc.tasks).toHaveLength(2);
  });
  it('today view includes pinned (carried over) and due tasks, not snoozed', () => {
    const pinned = newTask({ today: '2026-11-07' }, '');
    const due = newTask({ due: '2026-11-08' }, '');
    const snoozed = newTask({ today: TODAY, snooze_until: '2026-11-10' }, '');
    expect(isOnToday(pinned, TODAY)).toBe(true);
    expect(isOnToday(due, TODAY)).toBe(true);
    expect(isOnToday(snoozed, TODAY)).toBe(false);
    expect(matchesView(snoozed, { kind: 'snoozed' }, TODAY)).toBe(true);
  });
  it('label views use AND', () => {
    const t = newTask({ labels: ['project:apollo', 'req:marc'] }, '');
    expect(matchesView(t, { kind: 'labels', labels: ['project:apollo', 'req:marc'] }, TODAY)).toBe(true);
    expect(matchesView(t, { kind: 'labels', labels: ['project:apollo', 'req:bob'] }, TODAY)).toBe(false);
  });
  it('summarizes for reminders', () => {
    const doc = emptyDoc();
    doc.tasks.push(newTask({ today: TODAY }, ''), newTask({ waiting: { on: 'Marc', since: TODAY } }, ''));
    doc.time_corrections.push({ id: 'c', from: '2026-11-03T09:00', to: '2026-11-03T11:30', reason: '', task: null, submitted: false });
    expect(summarize(doc, TODAY)).toMatchObject({ today: 1, waiting: 1, pendingCorrections: 1, pendingMinutes: 150 });
  });

  it('addFromLine puts new tasks on top', () => {
    const doc = emptyDoc();
    const a = addFromLine(doc, 'First #x', TODAY, '2026-11-08T09:00');
    const b = addFromLine(doc, 'Second ^tomorrow', TODAY, '2026-11-08T09:01');
    expect(b.order).toBeLessThan(a.order);
    expect(b.due).toBe('2026-11-09');
    expect(a.labels).toEqual(['x']);
  });
  it('flags waiting tasks that need a follow-up', () => {
    const doc = emptyDoc();
    doc.tasks.push(
      newTask({ title: 'old', waiting: { on: 'Marc', since: '2026-11-03' } }, ''),
      newTask({ title: 'new', waiting: { on: 'Ops', since: '2026-11-07' } }, ''),
    );
    expect(staleWaiting(doc, TODAY).map((t) => t.title)).toEqual(['old']);
    expect(summarize(doc, TODAY).followUps).toEqual([{ on: 'Marc', title: 'old', days: 5 }]);
  });
  it('standup covers the previous workday (and the weekend) until today', () => {
    expect(previousWorkday('2026-11-09')).toBe('2026-11-06'); // Monday → Friday
    expect(previousWorkday('2026-11-11')).toBe('2026-11-10');
    const doc = emptyDoc();
    doc.tasks.push(
      newTask({ title: 'fri', done: '2026-11-06' }, ''),
      newTask({ title: 'sat', done: '2026-11-07' }, ''),
      newTask({ title: 'thu', done: '2026-11-05' }, ''),
      newTask({ title: 'pinned', today: '2026-11-09' }, ''),
      newTask({ title: 'blocked', today: '2026-11-09', waiting: { on: 'Marc', since: '2026-11-02' } }, ''),
    );
    const s = standup(doc, [newTask({ title: 'archived fri', done: '2026-11-06' }, '')], '2026-11-09');
    expect(s.yesterday.map((t) => t.title).sort()).toEqual(['archived fri', 'fri', 'sat']);
    expect(s.today.map((t) => t.title)).toEqual(['pinned']);
    expect(s.blocked.map((t) => t.title)).toEqual(['blocked']);
  });

});

describe('bulk add', () => {
  const LIST = ['#p:apollo @meeting ^fri', '', '- Update the export docs', '* Ask Marc for the pricing file #req:marc @email', '3. Review PROJ-7 ^mon', '[ ] Book room', '☐ Send notes *'].join('\n');
  it('strips bullets and checkboxes', () => {
    expect(['- a', '* b', '• c', '12. d', '3) e', '- [ ] f', '[x] g', '☐ h', '  - i'].map(stripBullet)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    expect(stripBullet('*')).toBe('*'); // the "today" token on its own stays
  });
  it('applies token-only lines to every task; own tokens win', () => {
    const { items, common } = parseBulk(LIST, TODAY, { p: 'project' });
    expect(items.map((c) => c.title)).toEqual(['Update the export docs', 'Ask Marc for the pricing file', 'Review PROJ-7', 'Book room', 'Send notes']);
    expect(common.labels).toEqual(['project:apollo']);
    expect(items.every((c) => c.labels.includes('project:apollo'))).toBe(true);
    expect(items[1]).toMatchObject({ source: 'email', labels: ['project:apollo', 'req:marc'] });
    expect(items[0]).toMatchObject({ source: 'meeting', due: '2026-11-13' });
    expect(items[2]).toMatchObject({ due: '2026-11-09', ref: 'PROJ-7', source: 'meeting' });
    expect(items[4].today).toBe(true);
  });
  it('adds in pasted order at the top of the list', () => {
    const doc = emptyDoc();
    addFromLine(doc, 'Existing', TODAY, '2026-11-08T08:00');
    const added = addText(doc, 'one\ntwo\nthree', TODAY, '2026-11-08T09:00');
    const sorted = [...doc.tasks].sort((a, b) => a.order - b.order).map((t) => t.title);
    expect(sorted).toEqual(['one', 'two', 'three', 'Existing']);
    expect(added.map((t) => t.today_order)).toEqual([...added.map((t) => t.today_order)].sort((a, b) => a - b));
  });
  it('a single line still works and token-only text adds nothing', () => {
    expect(parseBulk('Just one #x', TODAY).items).toHaveLength(1);
    expect(parseBulk('#x @email', TODAY).items).toHaveLength(0);
  });
});
