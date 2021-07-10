import { injectable } from 'tsyringe'

/** An injected utility class for retrieving the current time. */
@injectable()
export class Clock {
  /**
   * Retrieves the current time as a number of milliseconds since the epoch.
   *
   * @see Date.now
   */
  now(): number {
    return Date.now()
  }
}
