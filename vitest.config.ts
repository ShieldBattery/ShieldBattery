import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: './vitest-global-setup.ts',

    api: {
      port: 9527,
    },

    projects: [
      // App (Electron main process)
      {
        plugins: [
          swc.vite({
            module: { type: 'nodenext' },
          }),
        ],
        test: {
          name: 'app',
          environment: 'node',
          include: ['app/**/*.test.{js,ts,tsx}', 'common/**/*.test.{js,ts,tsx}'],
          exclude: ['app/dist/**', 'app/node_modules/**'],
          setupFiles: ['core-js/proposals/reflect-metadata'],
        },
      },
      // Server (Node)
      {
        plugins: [
          swc.vite({
            module: { type: 'nodenext' },
          }),
        ],
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.{js,ts,tsx}', 'common/**/*.test.{js,ts,tsx}'],
          exclude: ['server/public/**'],
          setupFiles: ['core-js/proposals/reflect-metadata'],
        },
      },
      // Client (Browser/happy-dom)
      {
        plugins: [
          react({
            babel: {
              presets: ['@babel/preset-typescript'],
              plugins: [
                ['@babel/plugin-proposal-decorators', { legacy: true }],
                ['babel-plugin-const-enum'],
              ],
            },
          }),
        ],
        test: {
          name: 'client',
          environment: 'happy-dom',
          include: ['client/**/*.test.{js,ts,tsx}', 'common/**/*.test.{js,ts,tsx}'],
          setupFiles: ['core-js/proposals/reflect-metadata', './vitest-client-setup.ts'],
          alias: {
            '\\.(svg)$': resolve(__dirname, 'client/__mocks__/svg-mock.tsx'),
            '\\.(html|htm|md)$': resolve(__dirname, 'client/__mocks__/static-file-mock.ts'),
          },
        },
      },
    ],

    coverage: {
      exclude: [
        '.react-email/**',
        'app/dist/**',
        'dist/**',
        'email/**',
        'server/migrations/**',
        'server/public/**',
      ],
      reporter: ['text', 'html'],
    },
  },
})
