/* eslint-disable @typescript-eslint/no-require-imports */
const plugin = require('../../../plugins/with-release-permissions') as {
  stripInternet: (m: { manifest: Record<string, unknown> }) => {
    manifest: { $: Record<string, string>; 'uses-permission': { $: Record<string, string> }[] };
  };
  shouldStrip: (env: Record<string, string | undefined>) => boolean;
};

describe('release builds have no INTERNET permission (ADR-017)', () => {
  it('replaces any INTERNET entry with a tools:node="remove" declaration', () => {
    const out = plugin.stripInternet({
      manifest: {
        $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
        'uses-permission': [
          { $: { 'android:name': 'android.permission.INTERNET' } },
          { $: { 'android:name': 'android.permission.POST_NOTIFICATIONS' } },
        ],
      },
    });
    expect(out.manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
    expect(out.manifest['uses-permission']).toEqual([
      { $: { 'android:name': 'android.permission.POST_NOTIFICATIONS' } },
      { $: { 'android:name': 'android.permission.INTERNET', 'tools:node': 'remove' } },
    ]);
  });

  it('only for release builds without a crash-reporting DSN', () => {
    expect(plugin.shouldStrip({ MASROOF_RELEASE: '1' })).toBe(true);
    expect(
      plugin.shouldStrip({ MASROOF_RELEASE: '1', EXPO_PUBLIC_SENTRY_DSN: 'https://k@e/1' }),
    ).toBe(false);
    expect(plugin.shouldStrip({})).toBe(false); // dev builds talk to Metro
  });
});
