type LogErrorFn = (msg: string) => void
export type ClientId = [type: number, hash: string]

export async function collect(
  logError: LogErrorFn,
  salt: string,
  installPath?: string,
): Promise<ClientId[]> {
  // TODO(tec27): implement
  return []
}
