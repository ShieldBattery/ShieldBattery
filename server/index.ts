import dotenv from 'dotenv'
import dotenvExpand from 'dotenv-expand'
import * as path from 'path'
import { setServerRoot } from './server-root.js'
dotenvExpand.expand(dotenv.config())

setServerRoot(path.join(process.cwd(), 'server'))

await import('./app.js')
