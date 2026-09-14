import styled, { css } from 'styled-components'
import { bodySmall, singleLine, titleSmall } from '../styles/typography'

// All card states share one fixed width, and no state is ever taller than the loading placeholder,
// so a state transition can only keep or shrink the card's footprint (shrinking is safe for the
// message list's autoscroll; only growth breaks it).
export const INLINE_CARD_WIDTH = 440
export const INLINE_CARD_PADDING = 8
export const INLINE_CARD_BORDER_WIDTH = 1

/** The square that leads a card: a map thumbnail, a user's avatar, etc. */
export const INLINE_CARD_THUMBNAIL_SIZE = 64

/** The gap between the rows an {@link InlineCardInfoColumn} stacks. */
export const INLINE_CARD_INFO_GAP = 2

export const inlineCardShell = css`
  width: ${INLINE_CARD_WIDTH}px;
  max-width: 100%;
  margin-top: 4px;
  /* The card renders inside the message container, whose hanging-indent trick
   * (72px padding pushed back out with a negative text-indent) is meant for message text only. */
  text-indent: 0;

  border-radius: 8px;

  /* The chat area sets user-select: text on every descendant so message text copies cleanly; the
   * card is UI rather than message text and must not splice itself into a copied selection. The
   * doubled class outranks that rule. */
  &&,
  && * {
    user-select: none;
  }
`

/**
 * The shell plus the card surface treatment. Each card sets its own `height` (see
 * {@link getInlineCardHeight}), since that depends on what it stacks in its info column.
 */
export const inlineCardBase = css`
  ${inlineCardShell};

  background-color: var(--theme-container-low);
  border: ${INLINE_CARD_BORDER_WIDTH}px solid var(--theme-outline-variant);
`

/**
 * Returns the fixed height a card renders at: whichever of its two columns is taller -- the leading
 * square, or the info stack of the given height -- plus the card's own padding and border. Cards pin
 * a single height so their loading placeholder reserves exactly what the loaded card occupies and a
 * loaded card never grows past that placeholder.
 */
export function getInlineCardHeight(infoStackHeight: number): number {
  return (
    Math.max(INLINE_CARD_THUMBNAIL_SIZE, infoStackHeight) +
    INLINE_CARD_PADDING * 2 +
    INLINE_CARD_BORDER_WIDTH * 2
  )
}

export const InlineCardRoot = styled.div<{ $height: number }>`
  ${inlineCardBase};
  height: ${props => props.$height}px;
  padding: ${INLINE_CARD_PADDING}px;

  display: flex;
  align-items: center;
  gap: 12px;
`

// A purely visual placeholder shown while the card's content is loading, sized to match
// `InlineCardRoot` (the tallest state) so the card never grows once the real content replaces it.
export const InlineCardLoading = styled.div<{ $height: number }>`
  ${inlineCardBase};
  height: ${props => props.$height}px;
`

// The same surface treatment as a live card, but collapsed to a single quiet line since there's
// nothing else to show. Shorter than the loading placeholder it replaces, which only ever shrinks
// the message.
export const InlineCardGone = styled.div`
  ${inlineCardShell};
  ${bodySmall};
  ${singleLine};
  padding: 8px 12px;

  color: var(--theme-on-surface-variant);
  background-color: var(--theme-container-low);
  border: ${INLINE_CARD_BORDER_WIDTH}px solid var(--theme-outline-variant);
`

export const InlineCardInfoColumn = styled.div`
  min-width: 0;
  flex-grow: 1;

  display: flex;
  flex-direction: column;
  gap: ${INLINE_CARD_INFO_GAP}px;
`

export const InlineCardTitle = styled.div`
  ${titleSmall};
  ${singleLine};
`

export const InlineCardSecondaryLine = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`
