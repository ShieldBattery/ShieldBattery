import * as React from 'react'
import styled, { css } from 'styled-components'
import { useOverflowingElement } from '../dom/overflowing-element'
import { buttonReset } from '../material/button-reset'
import { Tooltip } from '../material/tooltip'
import { bodySmall, labelLarge, singleLine, titleSmall } from '../styles/typography'
import {
  INLINE_CARD_BORDER_WIDTH,
  InlineCardGone,
  InlineCardLoading,
  inlineCardShell,
} from './inline-card'

/**
 * Chat cards that preview one thing (a game, a user, a lobby) over a blurred image of it. The whole
 * card performs its main action, a single quiet header line says what it is, and the body shows the
 * thing itself rather than a text summary of it.
 */

/**
 * Wider than the other inline cards, so a card's body has room to lay out what it previews (e.g.
 * two sides of a game, each with full player names beside their icons). The card still shrinks to
 * fit narrower chats.
 */
export const BACKDROP_CARD_WIDTH = 500
const BACKDROP_CARD_PADDING_Y = 12
const BACKDROP_CARD_PADDING_X = 16
const BACKDROP_CARD_GAP = 16
export const BACKDROP_CARD_HEADER_HEIGHT = 20

/**
 * Returns the fixed height a backdrop card renders at for a body of `bodyHeight`: the header line
 * over the body, plus the card's padding and border. Cards pin a single height so their loading
 * placeholder reserves what the loaded card occupies and a loaded card never grows past it.
 */
export function getBackdropCardHeight(bodyHeight: number): number {
  return (
    INLINE_CARD_BORDER_WIDTH * 2 +
    BACKDROP_CARD_PADDING_Y * 2 +
    BACKDROP_CARD_HEADER_HEIGHT +
    BACKDROP_CARD_GAP +
    bodyHeight
  )
}

const backdropCardWidth = css`
  width: ${BACKDROP_CARD_WIDTH}px;
`

export const BackdropCardLoading = styled(InlineCardLoading)`
  ${backdropCardWidth};
`

export const BackdropCardGone = styled(InlineCardGone)`
  ${backdropCardWidth};
`

/** A shadow that keeps text legible over the busier parts of a card's backdrop image. */
export const backdropTextShadow = css`
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.7);
`

const BackdropImage = styled.img`
  position: absolute;
  inset: 0;
  z-index: -2;
  width: 100%;
  height: 100%;

  object-fit: cover;
  filter: saturate(0.9) blur(1px);
  /* Slightly oversized at rest so the blur never pulls the card's background in at the edges. */
  transform: scale(1.03);
  transition: transform 600ms cubic-bezier(0.2, 0, 0, 1);

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`

const BackdropScrim = styled.div`
  position: absolute;
  inset: 0;
  z-index: -1;

  /* Darkest behind the header line, easing off behind the body so the image reads through. */
  background: linear-gradient(
    180deg,
    rgb(from var(--theme-container-low) r g b / 0.9) 0%,
    rgb(from var(--theme-container-low) r g b / 0.52) 50%,
    rgb(from var(--theme-container-low) r g b / 0.62) 100%
  );
  transition: opacity 300ms linear;
`

const BackdropCardRoot = styled.div<{ $height: number; $clickable: boolean }>`
  ${inlineCardShell};
  ${backdropCardWidth};
  position: relative;
  height: ${props => props.$height}px;
  padding: ${BACKDROP_CARD_PADDING_Y}px ${BACKDROP_CARD_PADDING_X}px;
  overflow: hidden;
  isolation: isolate;

  display: flex;
  flex-direction: column;
  gap: ${BACKDROP_CARD_GAP}px;

  background-color: var(--theme-container-low);
  border: ${INLINE_CARD_BORDER_WIDTH}px solid var(--theme-outline-variant);
  cursor: ${props => (props.$clickable ? 'pointer' : 'auto')};

  &:hover ${BackdropImage} {
    transform: scale(1.07);
  }

  &:hover ${BackdropScrim} {
    opacity: 0.9;
  }
`

/**
 * The card's keyboard and assistive-technology entry point: a transparent button stretched over the
 * card that pointer events pass straight through, so the card's content stays hoverable. It has no
 * click handler of its own; activating it dispatches a click that bubbles to the card's, which
 * performs the action.
 */
const CardLinkButton = styled.button`
  position: absolute;
  inset: 0;
  z-index: 1;
  margin: 0;
  padding: 0;

  background: transparent;
  border: none;
  border-radius: inherit;
  pointer-events: none;

  &:focus-visible {
    outline: 2px solid var(--theme-amber);
    outline-offset: -2px;
  }
`

/**
 * A card laid out as a header line over a body, with `imageUrl` blurred behind a scrim. When
 * `onClick` is set, the card's whole surface performs that one action (e.g. opening what it
 * previews), and content that handles clicks itself goes inside a {@link CardClickBoundary}. A card
 * without it (e.g. one listing several things, each interactive on its own) has no action of its own.
 */
export function BackdropCard({
  imageUrl,
  height,
  onClick,
  actionLabel,
  testName,
  className,
  children,
}: {
  imageUrl: string | undefined
  /** The card's fixed height (see {@link getBackdropCardHeight}). */
  height: number
  onClick?: () => void
  /** What the card's action does, for keyboard and assistive-technology users. */
  actionLabel?: string
  testName?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <BackdropCardRoot
      className={className}
      $height={height}
      $clickable={onClick !== undefined}
      onClick={
        onClick
          ? () => {
              // The click that ends a text selection is ignored, so a selection made across the
              // card doesn't also trigger it.
              if (window.getSelection()?.isCollapsed !== false) {
                onClick()
              }
            }
          : undefined
      }>
      {imageUrl ? <BackdropImage src={imageUrl} alt='' draggable={false} /> : null}
      <BackdropScrim />
      {children}
      {onClick ? (
        <CardLinkButton type='button' aria-label={actionLabel} data-testid={testName} />
      ) : null}
    </BackdropCardRoot>
  )
}

const CardClickBoundaryRoot = styled.span`
  display: contents;
`

/**
 * Keeps clicks inside it from reaching the card, for content that handles clicks itself (e.g. a
 * username). React events bubble through portals along the component tree, so this also covers the
 * menus and overlays such content opens.
 */
export function CardClickBoundary({ children }: { children: React.ReactNode }) {
  return (
    <CardClickBoundaryRoot onClick={event => event.stopPropagation()}>
      {children}
    </CardClickBoundaryRoot>
  )
}

/**
 * A tooltip for a card's content. Its trigger isn't a tab stop: card content is plain text and
 * images already exposed to assistive technology, and a chat full of cards would otherwise bury the
 * message list under tab stops.
 */
export function CardTooltip(props: Omit<React.ComponentProps<typeof Tooltip>, 'tabIndex'>) {
  return <Tooltip {...props} tabIndex={-1} />
}

const TooltipTextSpan = styled.span`
  ${singleLine};
  /* Keeps the spaces around separators that texts start with, which would otherwise collapse. */
  white-space: pre;
`

/**
 * A single line of text that ellipsizes when it doesn't fit, with a tooltip holding `tooltip` (shown
 * always) or else the full text (shown only while it's cut off).
 */
export function TooltipText({
  text,
  tooltip,
  className,
}: {
  text: string
  tooltip?: string
  className?: string
}) {
  const [ref, isOverflowing] = useOverflowingElement<HTMLSpanElement>()
  return (
    <CardTooltip
      className={className}
      text={tooltip ?? text}
      disabled={tooltip === undefined && !isOverflowing}>
      <TooltipTextSpan ref={ref}>{text}</TooltipTextSpan>
    </CardTooltip>
  )
}

/**
 * A card's header line: a title (see {@link BackdropCardTitle}), then its meta text (see
 * {@link BackdropCardMeta}), then any quiet actions (see {@link BackdropCardAction}).
 */
export const BackdropCardHeader = styled.div`
  height: ${BACKDROP_CARD_HEADER_HEIGHT}px;
  min-width: 0;
  flex-shrink: 0;

  display: flex;
  align-items: baseline;
  gap: 8px;
`

/** What kind of thing the card previews (e.g. a game's type), which keeps its full width. */
export const BackdropCardTitle = styled(TooltipText)`
  ${titleSmall};
  flex-shrink: 0;
  color: var(--theme-on-surface);
`

/**
 * The header's meta text: a run of {@link BackdropCardMetaText} and {@link BackdropCardMetaKeyText}
 * pieces, each after the first starting with its own " · " separator.
 */
export const BackdropCardMeta = styled.div`
  ${bodySmall};
  min-width: 0;
  flex-grow: 1;

  display: flex;
  align-items: baseline;

  color: var(--theme-on-surface-variant);
`

/** A piece of meta text that gives up its width before the key piece does. */
export const BackdropCardMetaText = styled(TooltipText)`
  min-width: 0;
`

/**
 * The meta text's key piece: it gives up its width only once the pieces after it have none left to
 * give, for the detail that's hardest to pick out anywhere else on the card (e.g. the name of the map
 * blurred behind it).
 */
export const BackdropCardMetaKeyText = styled(TooltipText)`
  flex-shrink: 0;
  max-width: 100%;
`

const BackdropCardActionButton = styled.button`
  ${buttonReset};
  ${labelLarge};
  flex-shrink: 0;
  align-self: center;
  height: 24px;
  padding: 0 4px;

  display: flex;
  align-items: center;
  gap: 4px;

  border-radius: 4px;
  color: var(--theme-on-surface-variant);
  cursor: pointer;
  transition: color 150ms linear;

  &:hover {
    color: var(--theme-on-surface);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-amber);
  }
`

/** A quiet text button for a secondary action in a card's header, which doesn't also click the card. */
export function BackdropCardAction({
  onClick,
  ariaLabel,
  ariaExpanded,
  testName,
  children,
}: {
  onClick: () => void
  ariaLabel?: string
  /** For an action that shows and hides part of the card, whether that part is shown. */
  ariaExpanded?: boolean
  testName?: string
  children: React.ReactNode
}) {
  return (
    <BackdropCardActionButton
      type='button'
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      onClick={event => {
        event.stopPropagation()
        onClick()
      }}
      data-testid={testName}>
      {children}
    </BackdropCardActionButton>
  )
}
