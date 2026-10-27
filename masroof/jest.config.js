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
    },
    {
      displayName: 'ui',
      preset: 'jest-expo',
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      testMatch: ['<rootDir>/tests/ui/**/*.test.tsx'],
    },
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  coverageThreshold: {
    './src/domain/': { statements: 90, branches: 90, functions: 90, lines: 90 },
  },
};
