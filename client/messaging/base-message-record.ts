/**
 * The base fields for all messages. Any added messages should implement this.
 */

export interface BaseMessage {
  readonly id: string
  readonly type: string
  readonly time: number
}
