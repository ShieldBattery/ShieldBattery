/**
 * Types describing a message window's failed edge requests. Kept apart from the row component that
 * renders them so the reducers that record load failures don't depend on UI code.
 */

/**
 * The request whose failure the older edge of a message window is showing: either a page of older
 * history, or a replacement window asked for around a point in time (whose wait already sits at the
 * older edge, so its failure lands there too). The time is kept so that retrying can ask for the
 * same window. A window asked for around a particular message isn't recorded here: its caller
 * returns the list to the present when it fails, so there's nothing left at the edge to retry.
 */
export type HistoryLoadError = { kind: 'history' } | { kind: 'around'; aroundTime?: number }

/** Which edge's load failed, and so what the row at it says. */
export type MessageLoadErrorKind = 'history' | 'newer' | 'around'
