import dotenv from 'dotenv'
import dotenvExpand from 'dotenv-expand'
dotenvExpand.expand(dotenv.config())

await import('./app.js')
