export const en = {
  app: {
    name: 'Masroof',
    tagline: 'Your money, on your phone only.',
  },
  common: {
    retry: 'Try again',
    continue: 'Continue',
    cancel: 'Cancel',
    loading: 'Loading…',
  },
  home: {
    title: 'Home',
    emptyTitle: 'No transactions yet',
    emptyBody: 'Track where your money goes. It stays encrypted on this device.',
    addFirst: 'Add your first expense',
    comingSoon: 'Quick add arrives in Phase 1.',
  },
  settings: {
    title: 'Settings',
    language: 'Language',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'System',
    numerals: 'Digits',
    numeralsLatn: 'Western (123)',
    numeralsArab: 'Eastern Arabic (١٢٣)',
    restartTitle: 'Restart required',
    restartBody: 'The app will restart to switch the layout direction.',
    restartNow: 'Restart now',
  },
  languages: {
    en: 'English',
    ar: 'العربية',
  },
  amount: {
    income: 'Income {{amount}}',
    expense: 'Expense {{amount}}',
    transfer: 'Transfer {{amount}}',
  },
  boot: {
    cipher_unavailable: {
      title: 'Secure storage unavailable',
      body: 'This build cannot encrypt your data, so it will not store any. Install the official app build (Expo Go is not supported).',
    },
    key_lost: {
      title: 'Your data could not be unlocked',
      body: 'The encryption key on this device is missing — this can happen after restoring a phone. Your data has not been deleted. Restore from a Masroof backup, or reset the app to start fresh.',
    },
    undecryptable: {
      title: 'Your data could not be read',
      body: 'The database could not be opened with this device’s key. Nothing has been deleted. Restore from a backup or contact support.',
    },
    secure_store_failed: {
      title: 'Could not save the encryption key',
      body: 'The device keystore refused to save the key, so no data was written. Make sure the device has a screen lock, then try again.',
    },
    newer_schema: {
      title: 'Update required',
      body: 'Your data was saved by a newer version of Masroof. Update the app to continue. Nothing has been changed.',
    },
    unexpected: {
      title: 'Something went wrong',
      body: 'The app could not start. Nothing has been deleted.',
    },
  },
};

export type TranslationShape = typeof en;
