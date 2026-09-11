import * as React from 'react'

/**
 * The two kinds of line a command can answer with. Info lines use the system-message colours;
 * error lines use the error colour.
 */
export type LocalLineKind = 'info' | 'error'

/**
 * What a command emits: a line only the running user sees. The surface that takes the line in
 * stamps it with an id and a time, and decides where it sits among the messages.
 */
export interface LocalLineContent {
  kind: LocalLineKind
  /**
   * The line's content. Names and other strong parts should be wrapped in `LocalStrong` (from
   * `./local-strong`), which the line layout colours according to the line's kind.
   */
  content: React.ReactNode
}

/** Takes a line a command produced into the surface the command was run in. */
export type LocalLineEmitter = (line: LocalLineContent) => void
