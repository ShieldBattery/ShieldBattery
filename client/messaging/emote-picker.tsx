import type EmojiPickerComponent from 'emoji-picker-react'
import type { EmojiClickData, EmojiStyle, Theme } from 'emoji-picker-react'
import type { EmojiData } from 'emoji-picker-react/dist/types/exposedTypes'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CUSTOM_EMOTES } from '../../common/text/custom-emotes'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { IconButton } from '../material/button'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { LoadingDotsArea } from '../progress/dots'
import { useStableCallback } from '../react/state-hooks'
import { inter, labelLarge, labelSmall } from '../styles/typography'
import { customEmoteImageUrl, customEmotesForPicker } from './custom-emotes'
import { getPickerEmojiData } from './emoji-data'
import { getShortcode } from './emoji-shortcodes'
import { recordEmoteUsage } from './emote-suggestions'
import { TEXT_ART_COMMANDS } from './text-art'

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

// The picker's dataset is loaded the same way, so both are ready together and the picker never
// mounts with the library's own (shortcode-less) bundled data.
let loadedPickerEmojiData: EmojiData | undefined

const Contents = styled.div`
  width: 350px;
`

const TextArtLabel = styled.div`
  ${labelLarge};
  /* The picker library styles every element inside it with a bare sans-serif font-family, at
     higher cascade priority than a single styled-components class — reassert the app font over
     it for the portalled content */
  && {
    ${inter};
  }
  position: sticky;
  top: 0;
  height: 40px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  background-color: var(--epr-category-label-bg-color);
  backdrop-filter: blur(3px);
`

const TextArtNavButton = styled.button`
  width: var(--epr-category-navigation-button-size, 30px);
  height: var(--epr-category-navigation-button-size, 30px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: none;
  color: var(--theme-on-surface);
  opacity: 0.6;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    opacity: 1;
  }

  /* The picker library forces sans-serif on every element inside it, which beats the icon
     component's own single-class font-family and would leave the icon's ligature text visible */
  && span {
    font-family: 'Material Symbols Outlined';
  }
`

const TextArtChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 10px;
`

const TextArtChip = styled.button`
  ${labelSmall};
  && {
    ${inter};
  }
  padding: 2px 10px;
  border: none;
  border-radius: 9999px;
  background: var(--theme-container-highest);
  color: var(--theme-on-surface);
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--theme-container-highest), var(--theme-on-surface) 8%);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-amber);
  }
`

const PreviewBar = styled.div`
  height: 44px;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-top: 1px solid var(--theme-outline-variant);
  background-color: var(--theme-container-low);
`

const PreviewGlyph = styled.span`
  font-size: 26px;
  line-height: 1;
`

const PreviewImg = styled.img`
  width: 26px;
  height: 26px;
`

const PreviewCode = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const PreviewHint = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
`

interface HoveredEmoji {
  /** The emoji glyph (built-in) or the custom emote's image URL, mutually exclusive. */
  glyph?: string
  imgUrl?: string
  /** `:shortcode:`-formatted display text, or `undefined` if it couldn't be resolved. */
  code: string | undefined
}

/**
 * A Discord-style preview bar shown at the bottom of the emoji picker, displaying the emoji
 * currently hovered (or focused via keyboard) and its `:shortcode:`. Hover state lives in this
 * component rather than in the caller so the constant stream of hover events doesn't re-render
 * the (heavy) picker library tree above it.
 */
function PickerPreviewBar({ contentsRef }: { contentsRef: RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState<HoveredEmoji>()

  useEffect(() => {
    const contents = contentsRef.current
    if (!contents) {
      return undefined
    }

    const onHover = (event: Event) => {
      // Delegated (rather than one listener per emoji) since the library renders hundreds of
      // emoji buttons at once
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button.epr-emoji')
      if (!target) {
        // Don't clear the preview on mouseout/focusout — like Discord, it keeps showing the last
        // hovered emoji until another one is hovered.
        return
      }
      const unified = target.dataset.unified
      if (!unified) {
        return
      }
      if (/^[0-9a-f-]+$/.test(unified)) {
        const shortcode = getShortcode(unified)
        setHovered({
          glyph: String.fromCodePoint(...unified.split('-').map(h => parseInt(h, 16))),
          code: shortcode ? `:${shortcode}:` : undefined,
        })
        return
      }
      // Custom emoji buttons carry their (lowercased) code as data-unified instead of a Unicode
      // codepoint sequence, since the library derives it from the `id` passed into its
      // customEmojis config (see customEmotesForPicker)
      const custom = CUSTOM_EMOTES.find(e => e.code.toLowerCase() === unified)
      if (custom) {
        setHovered({ imgUrl: customEmoteImageUrl(custom.code), code: `:${custom.code}:` })
      }
    }

    contents.addEventListener('mouseover', onHover)
    contents.addEventListener('focusin', onHover)
    return () => {
      contents.removeEventListener('mouseover', onHover)
      contents.removeEventListener('focusin', onHover)
    }
  }, [contentsRef])

  if (!hovered) {
    return (
      <PreviewBar>
        <PreviewHint>
          {t('messaging.emotePicker.previewHint', 'Hover an emoji to see its code')}
        </PreviewHint>
      </PreviewBar>
    )
  }

  return (
    <PreviewBar>
      {hovered.imgUrl ? (
        <PreviewImg src={hovered.imgUrl} alt='' />
      ) : (
        <PreviewGlyph>{hovered.glyph}</PreviewGlyph>
      )}
      {hovered.code ? <PreviewCode>{hovered.code}</PreviewCode> : null}
    </PreviewBar>
  )
}

const PickerArea = styled.div`
  height: 360px;

  /* The text art section is portalled into the picker's scroll body; hide it while a search
     query is active, the same way non-matching categories get hidden. */
  .EmojiPickerReact:has(input:not(:placeholder-shown)) .sb-text-art {
    display: none;
  }

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

  /* The library forces an OS-emoji-first font stack (e.g. "Segoe UI Emoji") on emoji glyphs via
     an !important rule, so reasserting the self-hosted emoji font needs !important too. */
  .epr-emoji-native {
    font-family: 'Noto Color Emoji', sans-serif !important;
  }
`

export interface EmotePickerButtonProps {
  className?: string
  disabled?: boolean
  /**
   * Called with the text to add to the input when the user picks an emoji. The picker closes
   * itself before this is called.
   */
  onInsert: (text: string) => void
}

/**
 * An icon button that opens an emoji picker for inserting into a chat input. The inserted content
 * is plain text, so messages need no special rendering support.
 */
export function EmotePickerButton({ className, disabled, onInsert }: EmotePickerButtonProps) {
  const { t } = useTranslation()
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition<HTMLButtonElement>(
    'right',
    'top',
  )
  const [pickerOpen, openPicker, closePicker] = usePopoverController({ refreshAnchorPos })
  const [EmojiPicker, setEmojiPicker] = useState(() => loadedEmojiPicker)
  const [pickerEmojiData, setPickerEmojiData] = useState(() => loadedPickerEmojiData)
  const contentsRef = useRef<HTMLDivElement>(null)
  const [textArtHost, setTextArtHost] = useState<HTMLElement>()
  const [textArtNavHost, setTextArtNavHost] = useState<HTMLElement>()

  useEffect(() => {
    if (pickerOpen && EmojiPicker && pickerEmojiData) {
      // The library's own search autofocus only applies the first time it mounts, so focus it
      // ourselves to make typing-to-search work on every open
      const timer = setTimeout(() => {
        contentsRef.current?.querySelector<HTMLInputElement>('.EmojiPickerReact input')?.focus()
      })
      return () => clearTimeout(timer)
    }
    return undefined
  }, [pickerOpen, EmojiPicker, pickerEmojiData])

  useEffect(() => {
    if (!pickerOpen || !EmojiPicker || !pickerEmojiData) {
      return undefined
    }

    // The text art section belongs after the last emoji category, scrolling with them, but the
    // picker library has no slot for extra sections — so a host element is appended to its scroll
    // body and the section is portalled into it. Deferred a tick so the library's contents exist
    // (they mount together with the popover's animation, same as the search focus above).
    let host: HTMLDivElement | undefined
    let navHost: HTMLDivElement | undefined
    const timer = setTimeout(() => {
      const scrollBody = contentsRef.current?.querySelector('.EmojiPickerReact .epr-body')
      if (scrollBody) {
        host = document.createElement('div')
        host.className = 'sb-text-art'
        scrollBody.appendChild(host)
        setTextArtHost(host)
      }

      // A jump-to-section button gets the same treatment in the library's category nav.
      // `display: contents` lets the portalled button lay out as a direct item of the nav's flex
      // row, alongside the real category buttons.
      const nav = contentsRef.current?.querySelector('.EmojiPickerReact .epr-category-nav')
      if (nav) {
        navHost = document.createElement('div')
        navHost.style.display = 'contents'
        nav.appendChild(navHost)
        setTextArtNavHost(navHost)
      }
    })
    return () => {
      clearTimeout(timer)
      host?.remove()
      setTextArtHost(undefined)
      navHost?.remove()
      setTextArtNavHost(undefined)
    }
  }, [pickerOpen, EmojiPicker, pickerEmojiData])

  const onPick = useStableCallback((text: string) => {
    closePicker()
    // The library focuses the picked emoji button on the next animation frame (even when it was
    // activated with Enter from the search field), which would steal focus from the input right
    // after the insert refocuses it — so wait out that focus before inserting
    requestAnimationFrame(() => requestAnimationFrame(() => onInsert(text)))
  })
  const onEmojiClick = useStableCallback((data: EmojiClickData) => {
    // Keyed the same way autocomplete suggestions are, so both feed the same frequency ordering
    recordEmoteUsage(data.isCustom ? data.emoji : `u:${data.emoji}`)
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
        title={t('messaging.emotePicker.buttonTitle', 'Add emoji')}
        disabled={disabled}
        onClick={event => {
          if (!loadedEmojiPicker) {
            emojiPickerPromise().then(
              picker => setEmojiPicker(() => picker),
              (err: Error) => logger.error(`Failed to load the emoji picker: ${String(err)}`),
            )
          }
          if (!loadedPickerEmojiData) {
            // Also kicks off loadShortcodes() internally, so the shortcode map is usually ready
            // by the time the user hovers an emoji and the preview bar's getShortcode looks it
            // up; getPickerEmojiData() caches its result, so this is a no-op on every open after
            // the first.
            getPickerEmojiData().then(
              data => {
                loadedPickerEmojiData = data
                setPickerEmojiData(data)
              },
              (err: Error) => logger.error(`Failed to load emoji data: ${String(err)}`),
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
            {EmojiPicker && pickerEmojiData ? (
              <EmojiPicker
                // These are type-only imports so the library stays in its lazy chunk; the casts
                // match the string values of the library's enums
                theme={'dark' as Theme}
                emojiStyle={'native' as EmojiStyle}
                // The library injects its stylesheet as an inline <style> tag, which our CSP only
                // allows when it carries the page's nonce
                nonce={(window as any).SB_CSP_NONCE}
                width='100%'
                height='100%'
                // The search is focused by our own effect above (which also covers reopening);
                // the library's autofocus can additionally re-fire while the popover's exit
                // animation still renders it, stealing focus from the input mid-insert
                autoFocusSearch={false}
                skinTonesDisabled={true}
                customEmojis={customEmotesForPicker()}
                // Replaces the library's bundled dataset with one that also carries every known
                // Discord/Slack-style shortcode, so its search finds emojis by shortcode too
                emojiData={pickerEmojiData}
                previewConfig={{ showPreview: false }}
                searchPlaceHolder={t('messaging.emotePicker.searchPlaceholder', 'Search emojis')}
                onEmojiClick={onEmojiClick}
              />
            ) : (
              <LoadingDotsArea />
            )}
          </PickerArea>
          <PickerPreviewBar contentsRef={contentsRef} />
          {textArtHost
            ? createPortal(
                <>
                  <TextArtLabel>{t('messaging.emotePicker.textArtLabel', 'Text art')}</TextArtLabel>
                  <TextArtChips>
                    {TEXT_ART_COMMANDS.map(({ command, art }) => (
                      <TextArtChip
                        key={command}
                        type='button'
                        // Multi-line art doesn't fit in a chip, so those show their command
                        // instead. The title teaches the command form for everything either way.
                        title={`/${command}`}
                        onClick={() => onPick(art.includes('\n') ? art : `${art} `)}>
                        {art.includes('\n') ? `/${command}` : art}
                      </TextArtChip>
                    ))}
                  </TextArtChips>
                </>,
                textArtHost,
              )
            : null}
          {textArtNavHost
            ? createPortal(
                <TextArtNavButton
                  type='button'
                  title={t('messaging.emotePicker.textArtLabel', 'Text art')}
                  onClick={() => textArtHost?.scrollIntoView({ block: 'start' })}>
                  <MaterialIcon icon='emoji_symbols' size={24} filled={false} />
                </TextArtNavButton>,
                textArtNavHost,
              )
            : null}
        </Contents>
      </Popover>
    </>
  )
}
