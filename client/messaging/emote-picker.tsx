import type EmojiPickerComponent from 'emoji-picker-react'
import type { EmojiClickData, EmojiStyle, Theme } from 'emoji-picker-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { IconButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { LoadingDotsArea } from '../progress/dots'
import { useStableCallback } from '../react/state-hooks'
import { labelMedium } from '../styles/typography'
import { customEmotesForPicker } from './custom-emotes'

// Deliberately lazy: the picker (and its emoji data) is a sizable chunk that most chat sessions
// never open, so it only loads the first time the popover is shown. Loaded imperatively rather
// than through React.lazy/Suspense — a suspending boundary inside the popover wedges
// AnimatePresence's exit animation, leaving the popover permanently stuck open.
let loadedEmojiPicker: typeof EmojiPickerComponent | undefined
const emojiPickerPromise = () =>
  import('emoji-picker-react').then(m => {
    loadedEmojiPicker = m.default
    return m.default
  })

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
  width: 350px;
`

const PickerArea = styled.div`
  height: 360px;

  /* Blend the library's panel into the app theme. */
  .EmojiPickerReact {
    --epr-bg-color: transparent;
    --epr-picker-border-color: transparent;
    --epr-category-label-bg-color: var(--theme-container-low);
    --epr-text-color: var(--theme-on-surface);
    --epr-search-input-bg-color: var(--theme-container-highest);
    --epr-search-input-text-color: var(--theme-on-surface);
    --epr-search-border-color: var(--theme-amber);
    --epr-hover-bg-color: rgb(from var(--theme-on-surface) r g b / 0.08);
    --epr-focus-bg-color: rgb(from var(--theme-on-surface) r g b / 0.12);
    --epr-highlight-color: var(--theme-amber);
  }
`

const SectionTitle = styled.div`
  ${labelMedium};
  padding: 8px 16px 4px;
  color: var(--theme-on-surface-variant);
`

const TextArtList = styled.div`
  max-height: 200px;
  padding-bottom: 8px;
  overflow-y: auto;
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
  const [EmojiPicker, setEmojiPicker] = useState(() => loadedEmojiPicker)
  const contentsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pickerOpen && EmojiPicker) {
      // The library's own search autofocus only applies the first time it mounts, so focus it
      // ourselves to make typing-to-search work on every open
      const timer = setTimeout(() => {
        contentsRef.current?.querySelector<HTMLInputElement>('.EmojiPickerReact input')?.focus()
      })
      return () => clearTimeout(timer)
    }
    return undefined
  }, [pickerOpen, EmojiPicker])

  const onPick = useStableCallback((text: string) => {
    closePicker()
    // The library focuses the picked emoji button on the next animation frame (even when it was
    // activated with Enter from the search field), which would steal focus from the input right
    // after the insert refocuses it — so wait out that focus before inserting
    requestAnimationFrame(() => requestAnimationFrame(() => onInsert(text)))
  })
  const onEmojiClick = useStableCallback((data: EmojiClickData) => {
    // Custom emotes travel in messages as `:code:` text (data.emoji is the code for them), while
    // built-in emojis are inserted as their Unicode character directly
    onPick(data.isCustom ? `:${data.emoji}: ` : data.emoji)
  })

  return (
    <>
      <IconButton
        ref={anchorRef}
        className={className}
        icon={<MaterialIcon icon='add_reaction' />}
        title={t('messaging.emotePicker.buttonTitle', 'Add emoji or text art')}
        disabled={disabled}
        onClick={event => {
          if (!loadedEmojiPicker) {
            emojiPickerPromise().then(
              picker => setEmojiPicker(() => picker),
              (err: Error) => logger.error(`Failed to load the emoji picker: ${String(err)}`),
            )
          }
          openPicker(event)
        }}
      />
      <Popover
        open={pickerOpen}
        onDismiss={closePicker}
        anchorX={anchorX ?? 0}
        anchorY={(anchorY ?? 0) - 8}
        originX='right'
        originY='bottom'
        // The search input gets focused instead (via the effect above), so the user can type to
        // filter right away
        focusOnMount={false}>
        <Contents
          ref={contentsRef}
          onKeyDownCapture={event => {
            // The picker library preventDefaults every Escape (it uses it to clear its search),
            // which stops the popover's own Escape handling from ever closing it. Close ourselves
            // when there's no search text to clear, so that Escape clears the search first and
            // then closes the picker.
            if (event.key === 'Escape') {
              const search =
                contentsRef.current?.querySelector<HTMLInputElement>('.EmojiPickerReact input')
              if (!search?.value) {
                event.preventDefault()
                event.stopPropagation()
                closePicker()
              }
            }
          }}>
          <PickerArea>
            {EmojiPicker ? (
              <EmojiPicker
                // These are type-only imports so the library stays in its lazy chunk; the casts
                // match the string values of the library's enums
                theme={'dark' as Theme}
                emojiStyle={'apple' as EmojiStyle}
                width='100%'
                height='100%'
                lazyLoadEmojis={true}
                // The search is focused by our own effect above (which also covers reopening);
                // the library's autofocus can additionally re-fire while the popover's exit
                // animation still renders it, stealing focus from the input mid-insert
                autoFocusSearch={false}
                skinTonesDisabled={true}
                customEmojis={customEmotesForPicker()}
                previewConfig={{ showPreview: false }}
                searchPlaceHolder={t('messaging.emotePicker.searchPlaceholder', 'Search emojis')}
                onEmojiClick={onEmojiClick}
              />
            ) : (
              <LoadingDotsArea />
            )}
          </PickerArea>
          <SectionTitle>{t('messaging.emotePicker.textArtSection', 'Text art')}</SectionTitle>
          <TextArtList>
            {getTextArtEntries(t).map(entry => (
              <TextArtItem
                key={entry.name}
                text={entry.art}
                secondaryText={entry.name}
                onClick={() => onPick(entry.art)}
              />
            ))}
          </TextArtList>
        </Contents>
      </Popover>
    </>
  )
}
