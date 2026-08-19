import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { useStableCallback } from '../react/state-hooks'
import { labelMedium } from '../styles/typography'

/**
 * A curated set of emojis likely to be useful in chat. These are inserted as plain Unicode text,
 * so anything not in this list can still be typed directly via the OS emoji input.
 */
const EMOJIS: ReadonlyArray<string> = [
  '😀',
  '😂',
  '🤣',
  '😅',
  '😉',
  '😊',
  '😍',
  '🤔',
  '😐',
  '🙄',
  '😬',
  '😢',
  '😭',
  '😱',
  '😡',
  '🥳',
  '🤯',
  '😎',
  '😴',
  '🤝',
  '👍',
  '👎',
  '👏',
  '🙏',
  '💪',
  '🫡',
  '✌️',
  '🔥',
  '❤️',
  '💔',
  '🎉',
  '💀',
  '⚔️',
  '🛡️',
  '🏆',
  '💥',
]

interface TextArtEntry {
  /** The text that gets inserted into the input. */
  art: string
  /** A short human-readable name, displayed next to the art in the picker. */
  name: string
}

// NOTE: Multi-line art is displayed (and rendered in chat) in a proportional font, so
// monospace-aligned art won't line up as authored. This art's spacing is tuned for how the
// app's font actually measures (spaces are much narrower than the other glyphs, hence the
// long leading runs). Anything added or changed here should be eyeballed in the picker to
// make sure it still reads well.
const TREX = [
  '                    __',
  '                  /  _)',
  '      _.----._/ /',
  '    /             /',
  '__/ (   |  (   |',
  "/__.-'|_|--|_|",
].join('\n')

function getTextArtEntries(t: (key: string, defaultValue: string) => string): TextArtEntry[] {
  return [
    { art: '¯\\_(ツ)_/¯', name: t('messaging.emotePicker.shrug', 'Shrug') },
    { art: '(╯°□°)╯︵ ┻━┻', name: t('messaging.emotePicker.tableFlip', 'Table flip') },
    { art: '┬─┬ ノ( ゜-゜ノ)', name: t('messaging.emotePicker.tableRestore', 'Put table back') },
    { art: 'ಠ_ಠ', name: t('messaging.emotePicker.disapproval', 'Disapproval') },
    { art: '( ͡° ͜ʖ ͡°)', name: t('messaging.emotePicker.lenny', 'Lenny') },
    { art: 'ʕ•ᴥ•ʔ', name: t('messaging.emotePicker.bear', 'Bear') },
    { art: "(ง'̀-'́)ง", name: t('messaging.emotePicker.fight', 'Ready to fight') },
    { art: '(ಥ﹏ಥ)', name: t('messaging.emotePicker.crying', 'Crying') },
    { art: 'ヽ(^o^)ノ', name: t('messaging.emotePicker.cheer', 'Cheer') },
    { art: 'o7', name: t('messaging.emotePicker.salute', 'Salute') },
    { art: TREX, name: t('messaging.emotePicker.trex', 'T-rex') },
  ]
}

const Contents = styled.div`
  width: 336px;
  max-height: 360px;
  padding: 8px 0;
  overflow-y: auto;
`

const SectionTitle = styled.div`
  ${labelMedium};
  padding: 4px 16px;
  color: var(--theme-on-surface-variant);
`

const EmojiGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  padding: 0 8px;
`

const EmojiButton = styled.button`
  height: 40px;

  display: flex;
  align-items: center;
  justify-content: center;

  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 22px;

  &:hover,
  &:focus-visible {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }
`

const TextArtItem = styled(MenuItem)`
  user-select: none;

  /* Let multi-line art render its line breaks instead of MenuItem's single-line ellipsis. The
     row already grows to fit because entries always have secondaryText. */
  & > div > div:first-child {
    white-space: pre-wrap;
    overflow: visible;
    text-overflow: unset;
  }
`

export interface EmotePickerButtonProps {
  className?: string
  disabled?: boolean
  /**
   * Called with the text to add to the input (an emoji or a piece of text art) when the user picks
   * one. The picker closes itself before this is called.
   */
  onInsert: (text: string) => void
}

/**
 * An icon button that opens a picker of emojis and classic text art, for inserting into a chat
 * input. The inserted content is plain text, so messages need no special rendering support.
 */
export function EmotePickerButton({ className, disabled, onInsert }: EmotePickerButtonProps) {
  const { t } = useTranslation()
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition<HTMLButtonElement>(
    'right',
    'top',
  )
  const [pickerOpen, openPicker, closePicker] = usePopoverController({ refreshAnchorPos })

  const onPick = useStableCallback((text: string) => {
    closePicker()
    onInsert(text)
  })

  return (
    <>
      <IconButton
        ref={anchorRef}
        className={className}
        icon={<MaterialIcon icon='add_reaction' />}
        title={t('messaging.emotePicker.buttonTitle', 'Add emoji or text art')}
        disabled={disabled}
        onClick={event => openPicker(event)}
      />
      <Popover
        open={pickerOpen}
        onDismiss={closePicker}
        anchorX={anchorX ?? 0}
        anchorY={(anchorY ?? 0) - 8}
        originX='right'
        originY='bottom'>
        <Contents>
          <SectionTitle>{t('messaging.emotePicker.emojiSection', 'Emoji')}</SectionTitle>
          <EmojiGrid>
            {EMOJIS.map(emoji => (
              <EmojiButton key={emoji} title={emoji} onClick={() => onPick(emoji)}>
                {emoji}
              </EmojiButton>
            ))}
          </EmojiGrid>
          <SectionTitle>{t('messaging.emotePicker.textArtSection', 'Text art')}</SectionTitle>
          {getTextArtEntries(t).map(entry => (
            <TextArtItem
              key={entry.name}
              text={entry.art}
              secondaryText={entry.name}
              onClick={() => onPick(entry.art)}
            />
          ))}
        </Contents>
      </Popover>
    </>
  )
}
