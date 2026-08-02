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
    // Reuses our HTTP server for the HMR websocket rather than opening a second port, which also
    // keeps HMR on the same origin as everything else.
    server: { middlewareMode: true, hmr: { server: httpServer } },
  })

  app.use(koaConnect(vite.middlewares))

  setShellTemplateSource(async url => {
    // Re-read rather than cache: the source shell is editable, and the tags Vite injects into it
    // are what make HMR and React Refresh work at all, so they must not go stale.
    const html = await readFile(SOURCE_SHELL_PATH, 'utf8')
    return await vite.transformIndexHtml(url, html)
  })
}
