import { fixupConfigRules, fixupPluginRules } from '@eslint/compat'
import { FlatCompat } from '@eslint/eslintrc'
import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import typescriptEslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import vitest from '@vitest/eslint-plugin'
import prettier from 'eslint-plugin-prettier'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

export default [
  {
    // NOTE(tec27): Make sure not to add any keys to this object or these won't be counted as global
    // ignores (you'll probably notice because it will take 10 years to lint)
    ignores: [
      '.react-email/',
      'build/',
      'dist/',
      'node_modules/',
      'app/build/',
      'app/dist/',
      'app/node_modules/',
      'game/',
      'server/node_modules/',
      'server/public/scripts/',
      'server/testing/google/',
      'server-rs/',
      'test-results/',
    ],
  },

  reactHooks.configs['recommended-latest'],

  ...fixupConfigRules(
    compat.extends(
      'eslint:recommended',
      'prettier',
      'plugin:@typescript-eslint/recommended',
      'plugin:react/recommended',
    ),
  ),

  {
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    files: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx'],

    plugins: {
      '@stylistic': stylistic,
      '@typescript-eslint': fixupPluginRules(typescriptEslint),
      prettier,
      react: fixupPluginRules(react),
    },

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        document: 'readonly',
        navigator: 'readonly',
        window: 'readonly',
        IS_ELECTRON: 'readonly',
        __WEBPACK_ENV: 'readonly',
      },

      parser: tsParser,
      ecmaVersion: 2021,
      sourceType: 'module',

      parserOptions: {
        ecmaFeatures: {
          legacyDecorators: true,
        },
      },
    },

    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },

    rules: {
      '@stylistic/eol-last': 'error',
      '@stylistic/linebreak-style': ['error', 'unix'],
      '@stylistic/new-parens': 'error',
      '@stylistic/no-floating-decimal': 'error',
      '@stylistic/no-multiple-empty-lines': [
        'error',
        {
          max: 2,
          maxEOF: 1,
        },
      ],
      '@stylistic/quotes': [
        'error',
        'single',
        {
          avoidEscape: true,
          allowTemplateLiterals: true,
        },
      ],
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/spaced-comment': [
        'error',
        'always',
        {
          markers: ['global', 'globals', 'eslint', 'eslint-disable', '*package', '!', ',', '/'],
        },
      ],
      '@stylistic/wrap-iife': ['error', 'any'],

      'prettier/prettier': 'error',

      'react/display-name': 'off',
      'react/jsx-boolean-value': ['error', 'always'],
      'react/jsx-no-target-blank': [
        'error',
        {
          allowReferrer: true,
        },
      ],
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/no-deprecated': 'off',
      'react/no-unescaped-entities': 'off',
      'react/prop-types': 'off',

      '@typescript-eslint/no-empty-object-type': [
        'error',
        {
          allowInterfaces: 'always',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-redeclare': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'none',
          caughtErrors: 'none',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-var-requires': 'off',

      'accessor-pairs': 'error',
      camelcase: [
        'error',
        {
          allow: ['.+_.+Fragment$'],
        },
      ],
      'consistent-return': 'error',
      'constructor-super': 'error',
      'dot-notation': 'error',
      eqeqeq: ['error', 'smart'],
      'max-nested-callbacks': ['error', 5],
      'max-params': ['error', 8],
      'no-alert': 'error',
      'no-array-constructor': 'error',
      'no-caller': 'error',
      'no-constant-condition': 'off',
      'no-eval': 'error',
      'no-extend-native': 'error',
      'no-extra-bind': 'error',
      'no-fallthrough': [
        'error',
        {
          allowEmptyCase: true,
        },
      ],
      'no-implied-eval': 'error',
      'no-inner-declarations': ['error', 'both'],
      'no-label-var': 'error',
      'no-labels': 'error',
      'no-lone-blocks': 'off',
      'no-multi-str': 'error',
      'no-nested-ternary': 'error',
      'no-new': 'error',
      'no-new-func': 'error',
      'no-new-object': 'error',
      'no-new-wrappers': 'error',
      'no-octal-escape': 'error',
      'no-proto': 'error',
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'Do not use the built-in fetch, use client/network/fetch instead.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-redux',
              importNames: ['useDispatch', 'useSelector'],
              message: 'Use useAppDispatch and useAppSelector from ./client/redux-hooks instead.',
            },
            {
              name: 'type-fest',
              importNames: ['Jsonify'],
              message: 'Use Jsonify from ./common/json instead.',
            },
            {
              name: 'electron',
              importNames: ['ipcMain', 'ipcRenderer'],
              message: 'Use ./common/ipc instead.',
            },
          ],
          patterns: [
            {
              group: ['motion/react'],
              importNames: ['motion'],
              message: "Use m instead: import * as m from 'motion/react-m'",
            },
            {
              group: ['*/gql/types'],
              message: 'Use the actual type import instead of the re-export for graphql scalars',
            },
          ],
        },
      ],
      'no-return-assign': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-undef': 'off',
      'no-undef-init': 'error',
      'no-unneeded-ternary': 'error',
      'no-unused-expressions': [
        'error',
        {
          allowTaggedTemplates: true,
        },
      ],
      'no-unused-vars': 'off',
      'no-var': 'error',
      'no-void': 'error',
      'no-warning-comments': [
        'error',
        {
          terms: ['fixme', 'do not submit', 'xxx'],
          location: 'start',
        },
      ],
      'object-shorthand': 'error',
      'prefer-const': 'error',
      'quote-props': ['error', 'as-needed'],
    },
  },
  ...fixupConfigRules(compat.extends('plugin:@typescript-eslint/recommended-type-checked')).map(
    config => ({
      ...config,
      files: ['**/*.ts', '**/*.tsx'],
    }),
  ),
  {
    files: ['**/*.ts', '**/*.tsx'],

    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'script',

      parserOptions: {
        project: true,
      },
    },

    rules: {
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-empty-object-type': [
        'error',
        {
          allowInterfaces: 'always',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-redeclare': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'none',
          caughtErrors: 'none',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['client/**/*.js', 'client/**/*.jsx', 'client/**/*.ts', 'client/**/*.tsx'],

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.commonjs,
        ...Object.fromEntries(Object.entries(globals.node).map(([key]) => [key, 'off'])),
      },
    },
  },
  {
    files: [
      '**/*.test.js',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/testing/*',
      '**/vitest-client-setup.ts',
      '**/vitest-global-setup.ts',
      '**/vitest-matchers.ts',
    ],

    plugins: { vitest },

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },

    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/expect-expect': 0,
    },
  },
  {
    files: ['server/migrations/**/*'],
    rules: {
      camelcase: 'off',
    },
  },
  {
    files: ['client/gql/fragment-masking.ts', 'client/gql/gql.ts'],

    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
]
