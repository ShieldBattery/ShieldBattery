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
  | 'horizontalRule'
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

/** How to rewrite a single line spanned by a line-prefix action. */
interface LinePlan {
  /** Number of characters stripped from the start of the line. */
  strip: number
  /** New prefix string inserted at the start of the line (after stripping). */
  prefix: string
}

/**
 * Rewrites the start of every line spanned by a selection, according to a caller-provided plan,
 * and maps the original selection through the edit.
 *
 * `planLines` receives the spanned lines (split on `\n`) and returns, for each one, how many
 * characters to strip from its start and what prefix (if any) to put in their place.
 *
 * The returned selection preserves the original selection's position *within the text*, rather
 * than selecting the whole modified line range: a caret sitting exactly at a line's start lands
 * immediately after that line's new prefix (it stays attached to the text it was in front of),
 * and a caret anywhere else on the line shifts by however much that line's prefix changed length.
 * This means e.g. a caret in the middle of a word stays in the same spot in the text, and
 * selecting whole lines and toggling a prefix keeps exactly that text selected afterwards.
 */
function toggleLinePrefix(
  content: string,
  selection: { start: number; end: number },
  planLines: (lines: string[]) => LinePlan[],
): FormatResult {
  const { start, end } = selection
  const lineStart = content.lastIndexOf('\n', start - 1) + 1
  const nextNewline = content.indexOf('\n', end)
  const lineEnd = nextNewline === -1 ? content.length : nextNewline

  const lines = content.slice(lineStart, lineEnd).split('\n')
  const plans = planLines(lines)

  // For each spanned line: its original start offset, and the cumulative length delta
  // (new prefix length - stripped length) contributed by every earlier spanned line.
  const lineStarts: number[] = []
  const deltaBefore: number[] = []
  let offset = lineStart
  let delta = 0
  for (let i = 0; i < lines.length; i++) {
    lineStarts.push(offset)
    deltaBefore.push(delta)
    delta += plans[i].prefix.length - plans[i].strip
    offset += lines[i].length + 1 // +1 for the '\n' separating this line from the next
  }

  const newSpan = lines.map((line, i) => plans[i].prefix + line.slice(plans[i].strip)).join('\n')

  const mapPos = (pos: number): number => {
    // Find the last spanned line whose start is <= pos; that's the line `pos` is on.
    let i = 0
    for (let j = 1; j < lineStarts.length; j++) {
      if (lineStarts[j] <= pos) {
        i = j
      }
    }
    const { strip, prefix } = plans[i]
    const lineOrigin = lineStarts[i]
    return pos <= lineOrigin + strip
      ? lineOrigin + deltaBefore[i] + prefix.length
      : pos + deltaBefore[i] + (prefix.length - strip)
  }

  return {
    content: content.slice(0, lineStart) + newSpan + content.slice(lineEnd),
    selectionStart: mapPos(start),
    selectionEnd: mapPos(end),
  }
}

const HEADING_H2_PREFIX = '## '
const HEADING_H3_PREFIX = '### '
const HEADING_PATTERN = /^#{1,6} /
const QUOTE_PREFIX = '> '
const UNORDERED_LIST_PREFIX = '- '
const ORDERED_LIST_PATTERN = /^\d+\.\s+/
const LINK_URL_PATTERN = /^https?:\/\/\S+$/
const LINK_TEXT_PLACEHOLDER = 'link text'
const LINK_URL_PLACEHOLDER = 'url'

/**
 * Cycles the heading level of every spanned line: none -> H2 -> H3 -> none.
 *
 * If every spanned line is already H2, they all become H3; if every spanned line is already H3,
 * the heading is removed; otherwise every spanned line is normalized to H2 (replacing any
 * existing `#` prefix instead of stacking onto it).
 */
function applyHeading(content: string, selection: { start: number; end: number }): FormatResult {
  return toggleLinePrefix(content, selection, lines => {
    if (lines.every(line => line.startsWith(HEADING_H2_PREFIX))) {
      return lines.map(() => ({ strip: HEADING_H2_PREFIX.length, prefix: HEADING_H3_PREFIX }))
    }
    if (lines.every(line => line.startsWith(HEADING_H3_PREFIX))) {
      return lines.map(() => ({ strip: HEADING_H3_PREFIX.length, prefix: '' }))
    }
    return lines.map(line => {
      const match = line.match(HEADING_PATTERN)
      return { strip: match ? match[0].length : 0, prefix: HEADING_H2_PREFIX }
    })
  })
}

function applyQuote(content: string, selection: { start: number; end: number }): FormatResult {
  return toggleLinePrefix(content, selection, lines => {
    const remove = lines.every(line => line.startsWith(QUOTE_PREFIX))
    return lines.map(() =>
      remove ? { strip: QUOTE_PREFIX.length, prefix: '' } : { strip: 0, prefix: QUOTE_PREFIX },
    )
  })
}

function applyUnorderedList(
  content: string,
  selection: { start: number; end: number },
): FormatResult {
  return toggleLinePrefix(content, selection, lines => {
    const remove = lines.every(line => line.startsWith(UNORDERED_LIST_PREFIX))
    return lines.map(() =>
      remove
        ? { strip: UNORDERED_LIST_PREFIX.length, prefix: '' }
        : { strip: 0, prefix: UNORDERED_LIST_PREFIX },
    )
  })
}

function applyOrderedList(
  content: string,
  selection: { start: number; end: number },
): FormatResult {
  return toggleLinePrefix(content, selection, lines => {
    const matches = lines.map(line => line.match(ORDERED_LIST_PATTERN))
    if (matches.every(match => match !== null)) {
      return matches.map(match => ({ strip: match![0].length, prefix: '' }))
    }
    return lines.map((line, i) => ({
      strip: matches[i]?.[0].length ?? 0,
      prefix: `${i + 1}. `,
    }))
  })
}

/**
 * Inserts a `---` horizontal rule as its own block, right after the selection end (any selected
 * text is left in place, not deleted).
 *
 * The rule is always separated from preceding text by a blank line: `text\n---` would parse as a
 * setext H2 heading rather than a paragraph followed by a rule, so if there's non-whitespace
 * content before the insertion point, it's kept (trailing whitespace trimmed) and joined to the
 * rule with a blank line. If there's only whitespace (or nothing) before the insertion point,
 * it's dropped and the rule simply starts the content. The rule is always followed by a blank
 * line, and any leading whitespace on the remaining content is stripped so it doesn't pile up.
 */
function applyHorizontalRule(
  content: string,
  selection: { start: number; end: number },
): FormatResult {
  const before = content.slice(0, selection.end)
  const after = content.slice(selection.end).replace(/^\s+/, '')

  const block = before.trim() === '' ? '---\n\n' : `${before.replace(/\s+$/, '')}\n\n---\n\n`

  return {
    content: block + after,
    selectionStart: block.length,
    selectionEnd: block.length,
  }
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
    case 'horizontalRule':
      return applyHorizontalRule(content, sel)
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
      <IconButton
        icon={<MaterialIcon icon='horizontal_rule' />}
        title={t('markdown.toolbar.horizontalRule', 'Divider')}
        disabled={disabled}
        onClick={() => onFormat('horizontalRule')}
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
