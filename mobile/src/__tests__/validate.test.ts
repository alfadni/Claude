import { InvalidForecastError, parseForecast } from '@/api/validate';
import { makeForecast } from '@/test-utils/fixtures';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function expectInvalid(raw: unknown, match: RegExp, expected?: { horizon: number; model: string }) {
  expect(() => parseForecast(raw, expected)).toThrow(InvalidForecastError);
  expect(() => parseForecast(raw, expected)).toThrow(match);
}

describe('parseForecast', () => {
  it('accepts a well-formed payload unchanged', () => {
    const f = makeForecast();
    expect(parseForecast(clone(f), { horizon: 30, model: 'ensemble' })).toEqual(f);
  });

  it('accepts a null backtest (short history)', () => {
    expect(parseForecast(clone(makeForecast({ backtest: null }))).backtest).toBeNull();
  });

  it.each([null, 'x', 42, []])('rejects a non-object body %p', (raw) => {
    expectInvalid(raw, /not an object/);
  });

  it('rejects empty series', () => {
    expectInvalid({ ...makeForecast(), forecast: [] }, /forecast is empty/);
    expectInvalid({ ...makeForecast(), history: [] }, /history is empty/);
  });

  it.each([
    ['NaN', NaN],
    ['zero', 0],
    ['negative', -0.1],
    ['string', '0.5'],
    ['Infinity', Infinity],
  ])('rejects a %s price', (_, bad) => {
    const f = clone(makeForecast()) as any;
    f.forecast[3].p95 = bad;
    expectInvalid(f, /forecast\[3\]\.p95/);
  });

  it('rejects crossed quantiles', () => {
    const f = clone(makeForecast()) as any;
    f.forecast[5].p25 = f.forecast[5].p75 * 1.1;
    expectInvalid(f, /quantiles are not ordered/);
  });

  it('rejects unordered or duplicate dates', () => {
    const f = clone(makeForecast()) as any;
    f.history[10].date = f.history[9].date;
    expectInvalid(f, /history dates are not increasing/);
  });

  it('rejects malformed dates', () => {
    const f = clone(makeForecast()) as any;
    f.forecast[0].date = '15/10/2026';
    expectInvalid(f, /not a date/);
  });

  it('rejects a forecast that overlaps the history', () => {
    const f = clone(makeForecast()) as any;
    f.forecast[0].date = f.history[f.history.length - 1].date;
    expectInvalid(f, /does not start after history/);
  });

  it('rejects a truncated forecast', () => {
    const f = clone(makeForecast()) as any;
    f.forecast.pop();
    expectInvalid(f, /29 days, expected 30/);
  });

  it('rejects a response for a different request', () => {
    expectInvalid(clone(makeForecast({ horizon: 7 })), /requested ensemble\/30d/, {
      horizon: 30,
      model: 'ensemble',
    });
  });

  it('rejects a missing stale flag or disclaimer', () => {
    const a = clone(makeForecast()) as any;
    delete a.stale;
    expectInvalid(a, /stale/);
    const b = clone(makeForecast()) as any;
    delete b.disclaimer;
    expectInvalid(b, /disclaimer/);
  });
});
