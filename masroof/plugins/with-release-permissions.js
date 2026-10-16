// Release builds without crash reporting make no network requests, so they
// must not hold android.permission.INTERNET (ADR-017, OPEN_QUESTIONS Q5).
// Libraries merge INTERNET into the manifest, so the app manifest declares it
// with tools:node="remove", which wins in Android's manifest merger.
const { withAndroidManifest } = require('expo/config-plugins');

const INTERNET = 'android.permission.INTERNET';

/** Pure manifest transform (unit-tested). */
function stripInternet(androidManifest) {
  const manifest = androidManifest.manifest;
  manifest.$ = { ...manifest.$, 'xmlns:tools': 'http://schemas.android.com/tools' };
  const others = (manifest['uses-permission'] ?? []).filter(
    (p) => p.$['android:name'] !== INTERNET,
  );
  manifest['uses-permission'] = [
    ...others,
    { $: { 'android:name': INTERNET, 'tools:node': 'remove' } },
  ];
  return androidManifest;
}

/** Strip only for release builds with no crash-reporting DSN; dev builds need Metro. */
function shouldStrip(env) {
  return env.MASROOF_RELEASE === '1' && !env.EXPO_PUBLIC_SENTRY_DSN;
}

function withReleasePermissions(config) {
  if (!shouldStrip(process.env)) return config;
  return withAndroidManifest(config, (c) => {
    c.modResults = stripInternet(c.modResults);
    return c;
  });
}

module.exports = withReleasePermissions;
module.exports.stripInternet = stripInternet;
module.exports.shouldStrip = shouldStrip;
