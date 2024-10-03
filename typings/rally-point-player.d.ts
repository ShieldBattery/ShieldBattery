declare module 'rally-point-player' {
  export interface PingTarget {
    address: string
    port: number
  }

  export interface PingResult {
    time: number
    server: PingTarget
  }

  export default class RallyPointPlayer {
    constructor(host: string, port: number)
    bind(): Promise<void>
    close(): void
    addErrorHandler(fn: (err: Error) => void): void
    removeErrorHandler(fn: (err: Error) => void): void
    pingServers(servers: PingTarget[]): Promise<PingResult[]>
  }
}
