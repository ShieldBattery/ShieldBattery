import { useEffect, useSyncExternalStore } from 'react'
import styled from 'styled-components'
import logger from '../logging/logger'
import { Tooltip } from '../material/tooltip'
import {
  areShortcodesLoaded,
  getShortcodeForEmoji,
  loadShortcodes,
  subscribeToShortcodesLoaded,
} from './emoji-shortcodes'

/**
 * A run of unicode emoji, rendered larger than the surrounding text. Normally it stays inline-sized
 * so the fixed 20px message line box doesn't grow (the glyph may paint slightly beyond the box).
 * When a message is nothing but emoji (and whitespace), it renders jumbo-sized instead, growing the
 * line, so it reads as a sticker rather than a sentence.
 */
const UnicodeEmoji = styled.span<{ $jumbo?: boolean }>`
  font-size: ${props => (props.$jumbo ? '32px' : '20px')};
  line-height: ${props => (props.$jumbo ? '1.2' : 'inherit')};
`

// The Tooltip wraps its trigger in a container; keeping it inline means the emoji keeps flowing
// with the surrounding text, so the message's line box and wrapping are unaffected.
const EmojiTooltip = styled(Tooltip)`
  display: inline;
`

/**
 * Kicks off the (once-per-session, lazy) shortcode dataset load the first time a message emoji
 * mounts, and re-renders the caller when it arrives, so a hover that started before the data was
 * there starts showing the shortcode without the message list re-rendering.
 */
function useShortcodesLoaded(): boolean {
  useEffect(() => {
    loadShortcodes().catch((err: Error) =>
      logger.error(`Failed to load emoji shortcodes: ${String(err)}`),
    )
  }, [])
  return useSyncExternalStore(subscribeToShortcodesLoaded, areShortcodesLoaded)
}

/**
 * A single unicode emoji sequence inside a text message, with a hover tooltip naming its
 * `:shortcode:` in the same format the emote picker's preview bar uses. `disabled` when there is
 * no shortcode (either not loaded yet or none in the dataset) so no empty bubble ever shows.
 * `tabIndex={-1}` keeps emoji out of the tab order (a message with ten emoji must not add ten
 * stops); the tooltip only opens on hover or keyboard focus, and keyboard focus can't reach it.
 */
export function MessageEmoji({ emoji, jumbo }: { emoji: string; jumbo?: boolean }) {
  const loaded = useShortcodesLoaded()
  const shortcode = loaded ? getShortcodeForEmoji(emoji) : undefined
  return (
    <EmojiTooltip
      text={shortcode ? `:${shortcode}:` : undefined}
      disabled={!shortcode}
      position='top'
      tabIndex={-1}>
      <UnicodeEmoji $jumbo={jumbo}>{emoji}</UnicodeEmoji>
    </EmojiTooltip>
  )
}
