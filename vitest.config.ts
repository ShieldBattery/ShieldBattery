import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'
import packageJson from './package.json' with { type: 'json' }

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
          include: [
            'server/**/*.test.{js,ts,tsx}',
            'common/**/*.test.{js,ts,tsx}',
            'tools/**/*.test.{js,ts,tsx}',
            'build-plugins/**/*.test.{js,ts,tsx}',
          ],
          exclude: ['server/public/**'],
          setupFiles: ['core-js/proposals/reflect-metadata'],
        },
      },
      // Client (Browser/happy-dom)
      {
        // No custom transforms needed beyond the standard React/TS handling: client/ and common/
        // contain no legacy decorators or const enums.
        plugins: [react()],
        // Mirrors what the client builds inject, so a module reading one of these behaves the same
        // under test as it does in a build. Vitest supplies MODE/DEV/PROD itself.
        //
        // `SB_SERVER` has to be a real value rather than left undefined: code that decides whether a
        // URL points at us compares against it, and tests cover those decisions.
        define: {
          'import.meta.env.SB_VERSION': JSON.stringify(packageJson.version),
          'import.meta.env.SB_SERVER': JSON.stringify('https://shieldbattery.net'),
        },
        test: {
          name: 'client',
          environment: 'happy-dom',
          include: ['client/**/*.test.{js,ts,tsx}', 'common/**/*.test.{js,ts,tsx}'],
          setupFiles: [
            'core-js/proposals/reflect-metadata',
            resolve(__dirname, 'vitest-client-setup.ts'),
          ],
          alias: {
            // The suffix is optional so this keeps matching if an import is ever written without
            // it; svgr only transforms `?react`, but either way a test wants the mock.
            '\\.svg(\\?react)?$': resolve(__dirname, 'client/__mocks__/svg-mock.tsx'),
            '\\.(html|htm|md)(\\?raw)?$': resolve(
              __dirname,
              'client/__mocks__/static-file-mock.ts',
            ),
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
