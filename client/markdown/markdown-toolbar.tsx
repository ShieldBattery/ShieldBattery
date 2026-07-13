import { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'

export type MarkdownFormatKind =
  | 'heading'
  | 'bold'
  | 'italic'
  | 'quote'
  | 'unorderedList'
  | 'orderedList'
  | 'link'

interface FormatResult {
  content: string
  selectionStart: number
  selectionEnd: number
}

/**
 * Toggles an inline marker (e.g. `**` for bold) around a selection.
 *
 * - If the selected text itself is wrapped in the marker, the marker is stripped and the inner
 *   text stays selected.
 * - Else if the marker immediately surrounds the selection, it's stripped from around it (the
 *   selected text is unaffected and stays selected).
 * - Otherwise the selection is wrapped in the marker, and the (now-wrapped) text stays selected.
 */
function toggleInlineMarker(
  marker: string,
  content: string,
  selection: { start: number; end: number },
): FormatResult {
  const { start, end } = selection
  const selected = content.slice(start, end)
  const markerLen = marker.length

  if (
    selected.length >= markerLen * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(markerLen, selected.length - markerLen)
    return {
      content: content.slice(0, start) + inner + content.slice(end),
      selectionStart: start,
      selectionEnd: start + inner.length,
    }
  }

  const before = content.slice(Math.max(0, start - markerLen), start)
  const after = content.slice(end, end + markerLen)
  if (before === marker && after === marker) {
    return {
      content: content.slice(0, start - markerLen) + selected + content.slice(end + markerLen),
      selectionStart: start - markerLen,
      selectionEnd: start - markerLen + selected.length,
    }
  }

  return {
    content: content.slice(0, start) + marker + selected + marker + content.slice(end),
    selectionStart: start + markerLen,
    selectionEnd: start + markerLen + selected.length,
  }
}

/**
 * Toggles a line prefix (e.g. `> ` for a quote) across every line spanned by a selection.
 *
 * If every spanned line already has the prefix, it's removed from all of them; otherwise it's
 * added to all of them. The full modified line range ends up selected.
 */
function toggleLinePrefix(
  content: string,
  selection: { start: number; end: number },
  hasPrefix: (line: string) => boolean,
  removePrefix: (line: string) => string,
  addPrefix: (line: string, index: number) => string,
): FormatResult {
  const { start, end } = selection
  const lineStart = content.lastIndexOf('\n', start - 1) + 1
  const nextNewline = content.indexOf('\n', end)
  const lineEnd = nextNewline === -1 ? content.length : nextNewline

  const lines = content.slice(lineStart, lineEnd).split('\n')
  const newLines = lines.every(hasPrefix)
    ? lines.map(removePrefix)
    : lines.map((line, i) => addPrefix(line, i))
  const newSpan = newLines.join('\n')

  return {
    content: content.slice(0, lineStart) + newSpan + content.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + newSpan.length,
  }
}

const HEADING_PREFIX = '## '
const QUOTE_PREFIX = '> '
const UNORDERED_LIST_PREFIX = '- '
const ORDERED_LIST_PATTERN = /^\d+\.\s+/
const LINK_URL_PATTERN = /^https?:\/\/\S+$/
const LINK_TEXT_PLACEHOLDER = 'link text'
const LINK_URL_PLACEHOLDER = 'url'

function applyHeading(content: string, selection: { start: number; end: number }): FormatResult {
  return toggleLinePrefix(
    content,
    selection,
    line => line.startsWith(HEADING_PREFIX),
    line => line.slice(HEADING_PREFIX.length),
    line => HEADING_PREFIX + line.replace(/^#{1,6} /, ''),
  )
}

function applyQuote(content: string, selection: { start: number; end: number }): FormatResult {
  return toggleLinePrefix(
    content,
    selection,
    line => line.startsWith(QUOTE_PREFIX),
    line => line.slice(QUOTE_PREFIX.length),
    line => QUOTE_PREFIX + line,
  )
}

function applyUnorderedList(
  content: string,
  selection: { start: number; end: number },
): FormatResult {
  return toggleLinePrefix(
    content,
    selection,
    line => line.startsWith(UNORDERED_LIST_PREFIX),
    line => line.slice(UNORDERED_LIST_PREFIX.length),
    line => UNORDERED_LIST_PREFIX + line,
  )
}

function applyOrderedList(
  content: string,
  selection: { start: number; end: number },
): FormatResult {
  return toggleLinePrefix(
    content,
    selection,
    line => ORDERED_LIST_PATTERN.test(line),
    line => line.replace(ORDERED_LIST_PATTERN, ''),
    (line, i) => `${i + 1}. ${line.replace(ORDERED_LIST_PATTERN, '')}`,
  )
}

function applyLink(content: string, selection: { start: number; end: number }): FormatResult {
  const { start, end } = selection
  const selected = content.slice(start, end)

  if (selected.length > 0 && LINK_URL_PATTERN.test(selected)) {
    const snippet = `[${LINK_TEXT_PLACEHOLDER}](${selected})`
    const textStart = start + 1
    return {
      content: content.slice(0, start) + snippet + content.slice(end),
      selectionStart: textStart,
      selectionEnd: textStart + LINK_TEXT_PLACEHOLDER.length,
    }
  }

  if (selected.length > 0) {
    const snippet = `[${selected}](${LINK_URL_PLACEHOLDER})`
    const urlStart = start + 1 + selected.length + 2
    return {
      content: content.slice(0, start) + snippet + content.slice(end),
      selectionStart: urlStart,
      selectionEnd: urlStart + LINK_URL_PLACEHOLDER.length,
    }
  }

  const snippet = `[${LINK_TEXT_PLACEHOLDER}](${LINK_URL_PLACEHOLDER})`
  const textStart = start + 1
  return {
    content: content.slice(0, start) + snippet + content.slice(end),
    selectionStart: textStart,
    selectionEnd: textStart + LINK_TEXT_PLACEHOLDER.length,
  }
}

/**
 * Applies a markdown formatting action to `content`, given the textarea's current selection.
 *
 * `selection` should be `undefined` when the textarea has never been focused (its
 * `selectionStart`/`selectionEnd` default to 0 before any user interaction); this is treated as a
 * collapsed cursor at the end of `content`.
 */
export function applyMarkdownFormat(
  kind: MarkdownFormatKind,
  content: string,
  selection: { start: number; end: number } | undefined,
): FormatResult {
  const sel = selection ?? { start: content.length, end: content.length }

  switch (kind) {
    case 'bold':
      return toggleInlineMarker('**', content, sel)
    case 'italic':
      return toggleInlineMarker('*', content, sel)
    case 'heading':
      return applyHeading(content, sel)
    case 'quote':
      return applyQuote(content, sel)
    case 'unorderedList':
      return applyUnorderedList(content, sel)
    case 'orderedList':
      return applyOrderedList(content, sel)
    case 'link':
      return applyLink(content, sel)
    default:
      return kind satisfies never
  }
}

const Root = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
`

const Divider = styled.span`
  width: 1px;
  height: 24px;
  background-color: var(--theme-outline-variant);
`

export function MarkdownToolbar({
  onFormat,
  disabled,
  children,
  className,
}: {
  onFormat: (kind: MarkdownFormatKind) => void
  disabled?: boolean
  children?: ReactNode
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <Root className={className}>
      <IconButton
        icon={<MaterialIcon icon='format_h2' />}
        title={t('markdown.toolbar.heading', 'Heading')}
        disabled={disabled}
        onClick={() => onFormat('heading')}
      />
      <IconButton
        icon={<MaterialIcon icon='format_bold' />}
        title={t('markdown.toolbar.bold', 'Bold')}
        disabled={disabled}
        onClick={() => onFormat('bold')}
      />
      <IconButton
        icon={<MaterialIcon icon='format_italic' />}
        title={t('markdown.toolbar.italic', 'Italic')}
        disabled={disabled}
        onClick={() => onFormat('italic')}
      />
      <Divider />
      <IconButton
        icon={<MaterialIcon icon='format_quote' />}
        title={t('markdown.toolbar.quote', 'Quote')}
        disabled={disabled}
        onClick={() => onFormat('quote')}
      />
      <IconButton
        icon={<MaterialIcon icon='format_list_bulleted' />}
        title={t('markdown.toolbar.unorderedList', 'Bulleted list')}
        disabled={disabled}
        onClick={() => onFormat('unorderedList')}
      />
      <IconButton
        icon={<MaterialIcon icon='format_list_numbered' />}
        title={t('markdown.toolbar.orderedList', 'Numbered list')}
        disabled={disabled}
        onClick={() => onFormat('orderedList')}
      />
      <Divider />
      <IconButton
        icon={<MaterialIcon icon='link' />}
        title={t('markdown.toolbar.link', 'Link')}
        disabled={disabled}
        onClick={() => onFormat('link')}
      />
      {children}
    </Root>
  )
}
