import 'reflect-metadata';
import { FixedScheduleCycle } from './dto/booking.dto';
import { resolveFixedSchedulePlan } from './booking.helpers';

function futureDate(yearOffset = 1) {
  const date = new Date();
  return `${date.getUTCFullYear() + yearOffset}-01-01`;
}

describe('resolveFixedSchedulePlan', () => {
  it('generates the requested number of weekly occurrences across multiple rules', () => {
    const plan = resolveFixedSchedulePlan({
      startDate: futureDate(),
      cycle: FixedScheduleCycle.WEEKLY,
      bookingMode: 'occurrence_count',
      occurrenceCount: 8,
      rules: [
        {
          dayOfWeek: 1,
          timeStart: '18:00',
          timeEnd: '20:00',
        },
        {
          dayOfWeek: 4,
          timeStart: '19:00',
          timeEnd: '21:00',
        },
      ],
    });

    expect(plan.occurrences).toHaveLength(8);
    expect(new Set(plan.occurrences.map((item) => item.dateKey)).size).toBe(8);
    expect(new Set(plan.occurrences.map((item) => item.timeStart))).toEqual(
      new Set(['18:00', '19:00']),
    );
    expect(plan.endDate).toEqual(plan.occurrences[7].date);
  });

  it('limits fixed weekly occurrences by each rule repeatWeeks value', () => {
    const plan = resolveFixedSchedulePlan({
      startDate: futureDate(),
      cycle: FixedScheduleCycle.WEEKLY,
      bookingMode: 'occurrence_count',
      occurrenceCount: 9,
      rules: [
        {
          dayOfWeek: 1,
          timeStart: '18:00',
          timeEnd: '20:00',
          repeatWeeks: 4,
        },
        {
          dayOfWeek: 4,
          timeStart: '19:00',
          timeEnd: '21:00',
          repeatWeeks: 5,
        },
      ],
    });

    expect(plan.occurrences).toHaveLength(9);
    expect(plan.occurrences.filter((item) => item.timeStart === '18:00')).toHaveLength(4);
    expect(plan.occurrences.filter((item) => item.timeStart === '19:00')).toHaveLength(5);
    expect(plan.endDate).toEqual(plan.occurrences[8].date);
  });

  it('allows odd specific-date rules to repeat for a custom number of weeks', () => {
    const startYear = new Date().getUTCFullYear() + 1;
    const plan = resolveFixedSchedulePlan({
      startDate: `${startYear}-01-01`,
      cycle: FixedScheduleCycle.WEEKLY,
      bookingMode: 'occurrence_count',
      occurrenceCount: 2,
      rules: [
        {
          specificDate: `${startYear}-01-14`,
          timeStart: '18:00',
          timeEnd: '20:00',
          repeat: false,
          repeatWeeks: 2,
        },
      ],
    });

    expect(plan.occurrences.map((item) => item.dateKey)).toEqual([
      `${startYear}-01-14`,
      `${startYear}-01-21`,
    ]);
  });

  it('clamps day 31 independently for each monthly occurrence', () => {
    const startYear = new Date().getUTCFullYear() + 1;
    const plan = resolveFixedSchedulePlan({
      startDate: `${startYear}-01-01`,
      cycle: FixedScheduleCycle.MONTHLY,
      bookingMode: 'occurrence_count',
      occurrenceCount: 3,
      rules: [
        {
          dayOfMonth: 31,
          timeStart: '18:00',
          timeEnd: '20:00',
        },
      ],
    });

    expect(plan.occurrences.map((item) => item.dateKey)).toEqual([
      `${startYear}-01-31`,
      `${startYear}-02-28`,
      `${startYear}-03-31`,
    ]);
  });

  it('allows multiple non-overlapping sessions on the same date', () => {
    const plan = resolveFixedSchedulePlan({
      startDate: futureDate(),
      cycle: FixedScheduleCycle.WEEKLY,
      bookingMode: 'occurrence_count',
      occurrenceCount: 8,
      rules: [
        {
          dayOfWeek: 1,
          timeStart: '18:00',
          timeEnd: '19:00',
        },
        {
          dayOfWeek: 1,
          timeStart: '20:00',
          timeEnd: '21:00',
        },
      ],
    });

    expect(plan.occurrences).toHaveLength(8);
    expect(plan.occurrences.slice(0, 2).map((item) => item.timeStart)).toEqual([
      '18:00',
      '20:00',
    ]);
  });

  it('rejects overlapping sessions generated on the same date', () => {
    expect(() =>
      resolveFixedSchedulePlan({
        startDate: futureDate(),
        cycle: FixedScheduleCycle.WEEKLY,
        bookingMode: 'occurrence_count',
        occurrenceCount: 8,
        rules: [
          {
            dayOfWeek: 1,
            timeStart: '18:00',
            timeEnd: '20:00',
          },
          {
            dayOfWeek: 1,
            timeStart: '19:00',
            timeEnd: '21:00',
          },
        ],
      }),
    ).toThrow(/bị trùng/);
  });

  it('keeps one-time rules as single occurrences alongside repeating rules', () => {
    const startYear = new Date().getUTCFullYear() + 1;
    const plan = resolveFixedSchedulePlan({
      startDate: `${startYear}-01-01`,
      cycle: FixedScheduleCycle.WEEKLY,
      bookingMode: 'occurrence_count',
      occurrenceCount: 5,
      rules: [
        {
          dayOfWeek: 1,
          timeStart: '18:00',
          timeEnd: '20:00',
          repeat: true,
        },
        {
          specificDate: `${startYear}-02-14`,
          timeStart: '09:00',
          timeEnd: '10:00',
          repeat: false,
        },
      ],
    });

    expect(plan.occurrences.filter((item) => item.timeStart === '09:00')).toHaveLength(1);
    expect(plan.occurrences).toHaveLength(5);
  });
});
