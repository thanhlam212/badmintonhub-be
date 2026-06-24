import { BadRequestException } from '@nestjs/common';
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

  it('rejects multiple rules that generate two sessions on the same date', () => {
    expect(() =>
      resolveFixedSchedulePlan({
        startDate: futureDate(),
        cycle: FixedScheduleCycle.WEEKLY,
        bookingMode: 'occurrence_count',
        occurrenceCount: 4,
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
      }),
    ).toThrow(BadRequestException);
  });
});
