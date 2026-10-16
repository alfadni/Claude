import { createSentryReporter, sentryOptions } from '@/services/crash/crash-reporter';
import { scrubEvent } from '@/services/crash/scrub';

/** A realistic Sentry event with personal data in every corner. */
const leaky = {
  event_id: 'abc123',
  timestamp: 1760600000,
  level: 'fatal',
  platform: 'javascript',
  release: 'masroof@0.1.0',
  environment: 'production',
  message: 'Rent 50,000.00 SDG to Landlord',
  logentry: { message: 'note: medicine for Amira' },
  exception: {
    values: [
      {
        type: 'SQLiteError',
        value: "UNIQUE constraint failed: payees.normalized_name 'dr. hassan clinic' 1250.00",
        mechanism: { type: 'onerror', handled: false, data: { note: 'secret' } },
        stacktrace: {
          frames: [
            {
              filename: '/Users/amira.ahmed/Library/Developer/app/main.jsbundle?amount=1250',
              function: 'createTransaction',
              lineno: 10,
              colno: 4,
              in_app: true,
              vars: { amountMinor: 125000, note: 'medicine' },
              context_line: 'const note = "medicine for Amira"',
              pre_context: ['amount = 125000'],
            },
            {
              filename: 'C:\\\\Users\\\\x\\\\index.js',
              function: 'console.log("pin 2580")',
              lineno: 2,
            },
          ],
        },
      },
      { type: 'Error: account Cash balance 5000', value: 'x' },
    ],
  },
  breadcrumbs: [{ message: 'tapped Save 1,250.00' }],
  extra: { amount: 125000 },
  tags: { account: 'Cash' },
  user: { id: 'device-1', ip_address: '10.0.0.1' },
  request: { url: 'masroof://transaction/1' },
  contexts: {
    os: { name: 'iOS', version: '19.0', kernel_version: 'Darwin user-iphone' },
    device: { name: "Amira's iPhone", model: 'iPhone17,1' },
    app: { app_name: 'Masroof' },
  },
  modules: { 'react-native': '0.88' },
};

describe('crash report scrubbing (ADR-017)', () => {
  it('keeps only the allow-list: stack shape, type, release, OS', () => {
    expect(scrubEvent(leaky)).toEqual({
      event_id: 'abc123',
      timestamp: 1760600000,
      level: 'fatal',
      platform: 'javascript',
      release: 'masroof@0.1.0',
      environment: 'production',
      exception: {
        values: [
          {
            type: 'SQLiteError',
            value: 'SQLiteError',
            mechanism: { type: 'onerror', handled: false },
            stacktrace: {
              frames: [
                {
                  filename: 'main.jsbundle',
                  function: 'createTransaction',
                  lineno: 10,
                  colno: 4,
                  in_app: true,
                },
                { filename: 'index.js', lineno: 2 },
              ],
            },
          },
          { type: 'Error', value: 'Error' },
        ],
      },
      contexts: { os: { name: 'iOS', version: '19.0' } },
    });
  });

  it('no amount, note, payee, account, PIN, name or path survives anywhere', () => {
    const out = JSON.stringify(scrubEvent(leaky));
    for (const secret of [
      '50,000',
      '1250',
      '125000',
      'Landlord',
      'medicine',
      'Amira',
      'amira',
      'hassan',
      'Cash',
      '2580',
      '/Users',
      'Users',
      '10.0.0.1',
      'device-1',
      'masroof://',
      'iPhone17',
    ]) {
      expect([secret, out.includes(secret)]).toEqual([secret, false]);
    }
  });

  it('garbage in, empty out', () => {
    expect(scrubEvent(null)).toEqual({});
    expect(scrubEvent('boom')).toEqual({});
    expect(scrubEvent({ exception: { values: 'nope' } })).toEqual({});
  });

  it('SDK options never collect PII, breadcrumbs, screenshots or traces', () => {
    const o = sentryOptions('https://key@example.invalid/1', 'masroof@1');
    expect(o).toMatchObject({
      sendDefaultPii: false,
      maxBreadcrumbs: 0,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableAutoSessionTracking: false,
      tracesSampleRate: 0,
    });
    expect((o.beforeBreadcrumb as () => unknown)()).toBeNull();
    expect((o.beforeSend as (e: unknown) => unknown)(leaky)).toEqual(scrubEvent(leaky));
  });
});

describe('crash reporter lifecycle', () => {
  it('without a DSN it is unavailable and never loads the SDK', async () => {
    const load = jest.fn();
    const r = createSentryReporter({ dsn: undefined, release: '1', load });
    expect(r.available).toBe(false);
    await r.start();
    expect(load).not.toHaveBeenCalled();
  });

  it('starts once, stops by closing, and never throws', async () => {
    const sdk = { init: jest.fn(), close: jest.fn(async () => true) };
    const r = createSentryReporter({
      dsn: 'https://k@e.invalid/1',
      release: '1',
      load: async () => sdk,
    });
    await r.start();
    await r.start();
    expect(sdk.init).toHaveBeenCalledTimes(1);
    await r.stop();
    expect(sdk.close).toHaveBeenCalledTimes(1);
    const broken = createSentryReporter({
      dsn: 'https://k@e.invalid/1',
      release: '1',
      load: async () => {
        throw new Error('native module missing');
      },
    });
    await expect(broken.start()).resolves.toBeUndefined();
  });
});
