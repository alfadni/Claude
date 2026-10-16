// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');

// Physical (left/right) layout breaks RTL. Use start/end equivalents.
const PHYSICAL_STYLE_KEYS =
  '/^(left|right|marginLeft|marginRight|paddingLeft|paddingRight|borderLeftWidth|borderRightWidth|borderLeftColor|borderRightColor|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius)$/';

const noFloatMoney = [
  {
    selector: "CallExpression[callee.name='parseFloat']",
    message: 'No floating-point parsing. Use parseAmount / integer minor units.',
  },
  {
    selector: "MemberExpression[property.name='toFixed']",
    message: 'No floating-point formatting. Use formatMoney.',
  },
];

const layer = (forbidden, message) => ({
  'no-restricted-imports': [
    'error',
    { patterns: forbidden.map((group) => ({ group: [group], message })) },
  ],
});

module.exports = defineConfig([
  expoConfig,
  prettier,
  {
    ignores: ['node_modules/*', 'coverage/*', '.expo/*', 'ios/*', 'android/*'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': ['error', ...noFloatMoney],
    },
  },
  {
    files: ['src/**', 'app/**'],
    rules: layer(['node:*'], 'App code runs on Hermes, not Node.'),
  },
  {
    files: ['app/**/*.tsx', 'src/ui/**/*.tsx', 'src/features/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...noFloatMoney,
        {
          selector: `Property[key.name=${PHYSICAL_STYLE_KEYS}]`,
          message: 'Use logical properties (start/end, marginStart, paddingEnd…) for RTL.',
        },
        {
          selector: "Property[key.name='textAlign'][value.value=/^(left|right)$/]",
          message: "Use textAlign 'auto' or a logical alignment helper for RTL.",
        },
      ],
    },
  },
  // Layering: ui → features → services → domain ← data
  {
    files: ['src/domain/**'],
    rules: layer(
      [
        'react',
        'react-native',
        'react-native/*',
        'expo*',
        'drizzle-orm*',
        '@/data/*',
        '@/services/*',
        '@/features/*',
        '@/ui/*',
        '@/i18n/*',
      ],
      'domain must stay framework-free (no RN/Expo/DB imports).',
    ),
  },
  {
    files: ['src/data/**'],
    rules: layer(
      ['react', 'react-native', '@/services/*', '@/features/*', '@/ui/*'],
      'data may depend on domain only.',
    ),
  },
  {
    files: ['src/ui/**'],
    rules: layer(
      ['@/data/*', '@/services/*', '@/features/*'],
      'ui must not reach into data/services/features.',
    ),
  },
  {
    files: ['src/services/**'],
    rules: layer(['@/features/*', '@/ui/*'], 'services must not depend on features/ui.'),
  },
]);
