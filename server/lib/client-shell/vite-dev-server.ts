import Koa from 'koa'
import koaConnect from 'koa-connect'
import { readFile } from 'node:fs/promises'
import { Server } from 'node:http'
import path from 'node:path'
import { createServer } from 'vite'
import { setShellTemplateSource } from './client-shell'

/** The shell before the build touches it. Only meaningful in development. */
const SOURCE_SHELL_PATH = path.join(__dirname, '..', '..', '..', 'index.html')

/**
 * Runs Vite inside our Koa server for development, so client modules are served from the same
 * origin as the API and HMR needs no second port.
 *
 * Must be called before the routes are attached: the catch-all route would otherwise answer
 * requests for client modules with the shell HTML.
 *
 * This module is only ever loaded in development -- it pulls in Vite, which is a devDependency.
 */
export async function attachViteDevServer(app: Koa, httpServer: Server): Promise<void> {
  const vite = await createServer({
    server: {
      // Reuses our HTTP server for the HMR websocket rather than opening a second port, which also
      // keeps HMR on the same origin as everything else.
      middlewareMode: true,
      hmr: { server: httpServer },
      // Vite's root is the repo root and its default ignores cover only .git, node_modules,
      // test-results and outDir. Without these the watcher also walks the Rust build directories
      // -- 60k+ files between them, rewritten continuously whenever the Rust server is running
      // alongside this one, which `local-dev` does by default.
      watch: {
        ignored: [
          '**/target/**',
          '**/app/dist/**',
          '**/server/public/**',
          '**/server/uploaded_files/**',
        ],
      },
      // Vite serves anything under the workspace root on this port, not just built assets, so the
      // denylist is what keeps the rest of the repo out of reach.
      //
      // This *replaces* Vite's default rather than extending it, so the default has to be
      // restated here or `.env`, keys and `.git` stop being protected. The only deliberate change
      // is `.env*` in place of `.env` + `.env.*`, which additionally covers the `.env-build` at
      // the repo root. Re-check this list when upgrading Vite.
      fs: {
        deny: ['.env*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**'],
      },
    },
  })

  app.use(koaConnect(vite.middlewares))

  setShellTemplateSource(async url => {
    // Re-read rather than cache: the source shell is editable, and the tags Vite injects into it
    // are what make HMR and React Refresh work at all, so they must not go stale.
    const html = await readFile(SOURCE_SHELL_PATH, 'utf8')
    return await vite.transformIndexHtml(url, html)
  })
}
