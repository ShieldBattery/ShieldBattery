import crypto from 'crypto'

type LogErrorFn = (msg: string) => void
export type ClientId = [type: number, hash: string]

function hashWithSalt(salt: string, val: string): string {
  return crypto.createHash('sha256').update(salt).update(val).digest('hex')
}

export async function collect(
  logError: LogErrorFn,
  salt: string,
  installPath?: string,
): Promise<ClientId[]> {
  const id = process.env.SB_SESSION || 'session'
  return [[7, hashWithSalt(salt, id)]]
}
