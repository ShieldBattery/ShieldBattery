declare module 'rally-point-creator' {
  interface CreatedRoute {
    p1Id: string
    p2Id: string
    routeId: string
  }

  export default class RallyPointCreator {
    constructor(host: string, port: number, secret: string)
    bind(): Promise<void>
    close(): void
    addErrorHandler(fn: (err: Error) => void): void
    removeErrorHandler(fn: (err: Error) => void): void
    createRoute(host: string, port: number, timeoutMs?: number): Promise<CreatedRoute>
  }
}
