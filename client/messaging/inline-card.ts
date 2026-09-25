import styled, { css } from 'styled-components'
import { bodySmall, singleLine } from '../styles/typography'

// All card states share one fixed width, and no state is ever taller than the loading placeholder,
// so a state transition can only keep or shrink the card's footprint (shrinking is safe for the
// message list's autoscroll; only growth breaks it).
const INLINE_CARD_WIDTH = 440
export const INLINE_CARD_BORDER_WIDTH = 1

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

/** The shell plus the card surface treatment. */
const inlineCardBase = css`
  ${inlineCardShell};

  background-color: var(--theme-container-low);
  border: ${INLINE_CARD_BORDER_WIDTH}px solid var(--theme-outline-variant);
`

// A purely visual placeholder shown while the card's content is loading, at the height of the
// loaded card it stands in for, so the card never grows once the real content replaces it.
export const InlineCardLoading = styled.div<{ $height: number }>`
  ${inlineCardBase};
  height: ${props => props.$height}px;
`

// The same surface treatment as a live card, but collapsed to a single quiet line since there's
// nothing else to show. Shorter than the loading placeholder it replaces, which only ever shrinks
// the message.
export const InlineCardGone = styled.div`
  ${inlineCardBase};
  ${bodySmall};
  ${singleLine};
  padding: 8px 12px;

  color: var(--theme-on-surface-variant);
`
