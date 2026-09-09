/** Upper bound on remembered messages per conversation; the oldest are dropped past it. */
export const MAX_SENT_MESSAGE_HISTORY = 100

/**
 * The messages a user has sent in one conversation, newest last, plus a cursor for recalling them
 * into the input with the arrow keys. Recall starts from an empty input and steps through entries
 * only while the input still holds exactly the entry it was last given, so anything the user has
 * typed or edited is never replaced.
 */
export class SentMessageHistory {
  private entries: string[] = []
  /** Index of the entry currently shown in the input, or -1 when not recalling. */
  private index = -1

  /** Records a sent message as the newest entry and ends any recall in progress. */
  push(text: string): void {
    if (text !== this.entries[this.entries.length - 1]) {
      this.entries.push(text)
      if (this.entries.length > MAX_SENT_MESSAGE_HISTORY) {
        this.entries.shift()
      }
    }
    this.index = -1
  }

  /**
   * Handles an Up press. Returns the text to put in the input, or undefined if the press should be
   * left to the input's normal handling.
   */
  older(current: string): string | undefined {
    if (this.entries.length === 0) {
      return undefined
    }

    if (current === '') {
      this.index = this.entries.length - 1
      return this.entries[this.index]
    } else if (this.index >= 0 && current === this.entries[this.index] && this.index > 0) {
      this.index--
      return this.entries[this.index]
    } else {
      return undefined
    }
  }

  /**
   * Handles a Down press. Returns the text to put in the input, or undefined if the press should
   * be left to the input's normal handling. Stepping past the newest entry ends the recall and
   * returns an empty string, which is what the input held when recall began.
   */
  newer(current: string): string | undefined {
    if (this.index < 0) {
      return undefined
    }
    if (current !== this.entries[this.index]) {
      return undefined
    }

    if (this.index < this.entries.length - 1) {
      this.index++
      return this.entries[this.index]
    } else {
      this.index = -1
      return ''
    }
  }
}
