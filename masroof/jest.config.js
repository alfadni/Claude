/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      // Pure TS layers (domain, data, services) run in plain Node so the
      // real SQLite engine (better-sqlite3) can back repository tests.
      displayName: 'node',
      testEnvironment: 'node',
      transform: { '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      testMatch: ['<rootDir>/tests/node/**/*.test.ts'],
      // @noble/* ship ESM only.
      transformIgnorePatterns: ['/node_modules/(?!@noble/)'],
    },
    {
      // 73k-row ledger: query plans and time budgets (docs/PERFORMANCE.md).
      displayName: 'perf',
      testEnvironment: 'node',
      transform: { '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      testMatch: ['<rootDir>/tests/perf/**/*.test.ts'],
      transformIgnorePatterns: ['/node_modules/(?!@noble/)'],
      setupFilesAfterEnv: ['<rootDir>/tests/perf/setup.ts'],
    },
    {
      displayName: 'ui',
      preset: 'jest-expo',
      // testTimeout is ignored inside `projects`; the setup file sets it.
      setupFilesAfterEnv: ['<rootDir>/tests/ui/setup.ts'],
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      testMatch: ['<rootDir>/tests/ui/**/*.test.tsx'],
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@noble/.*)',
      ],
    },
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  coverageThreshold: {
    './src/domain/': { statements: 90, branches: 90, functions: 90, lines: 90 },
  },
};
