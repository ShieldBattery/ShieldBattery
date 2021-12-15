export declare global {
  interface Window {
    fathom?: {
      trackGoal(eventId: string, valueInCents: number): void
    }
  }
}
