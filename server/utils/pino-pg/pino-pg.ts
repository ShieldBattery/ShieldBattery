// This is largely taken from the 'pino-pg' module, which has a number of unpublished fixes we need
// and also doesn't easily allow us to use our .env setup. This assumes SB's particular DB setup
// by default.

import { Client } from 'pg'
import split from 'split2'
import { pipeline, Transform, TransformCallback } from 'stream'

class PgTransport extends Transform {
  constructor(private client: Client, private table = 'server_logs', private column = 'data') {
    super()

    process.on('SIGINT', () => this.shutdown())
    process.on('SIGTERM', () => this.shutdown())
  }

  private shutdown() {
    process.exit(0)
  }

  override _transform(chunk: any, encoding: string, callback: TransformCallback) {
    const content = chunk.toString('utf-8')
    let log: any
    try {
      log = JSON.parse(content)
    } catch {
      // pass through non-JSON
      callback(null, `${chunk}\n`)
      return
    }
    this.client.query(`INSERT INTO ${this.table}(${this.column}) VALUES($1)`, [log]).then(
      () => {
        callback(null, `${chunk}\n`)
      },
      err => callback(err, null),
    )
  }
}

function transporter(client: Client, table?: string, column?: string) {
  const pgTransport = new PgTransport(client, table, column)
  pgTransport.on('end', () => {
    client.end()
  })
  return pgTransport
}

function main() {
  if (!process.env.DATABASE_URL) {
    console.error('pino-pg: DATABASE_URL must be specified')
    return
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  client.connect(connectErr => {
    if (connectErr !== null) {
      console.error('pino-pg: Failed to connect to PostgreSQL server.', connectErr)
      return
    }
    pipeline(process.stdin, split(), transporter(client), process.stdout, err => {
      if (err != null) {
        console.error(err)
      }
    })
  })
}

main()
