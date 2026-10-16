const path = require('path');

// npm nests expo-modules-core under expo/, where jest-expo's setup can't
// resolve it; point Jest at expo's own copy rather than installing a second.
const expoModulesCore = path.dirname(
  require.resolve('expo-modules-core/package.json', {
    paths: [path.dirname(require.resolve('expo/package.json'))],
  }),
);

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['./jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^expo-modules-core$': expoModulesCore,
    '^expo-modules-core/(.*)$': `${expoModulesCore}/$1`,
  },
};
