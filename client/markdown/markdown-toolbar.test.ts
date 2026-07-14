import { describe, expect, test } from 'vitest'
import { applyMarkdownFormat } from './markdown-toolbar'

describe('applyMarkdownFormat', () => {
  describe('bold', () => {
    test('wraps a plain selection in ** markers and keeps the text selected', () => {
      const content = 'Hello world'
      const start = content.indexOf('world')
      const end = start + 'world'.length

      const result = applyMarkdownFormat('bold', content, { start, end })

      expect(result.content).toBe('Hello **world**')
      expect(result.content.slice(result.selectionStart, result.selectionEnd)).toBe('world')
      expect(result.selectionStart).toBe(8)
      expect(result.selectionEnd).toBe(13)
    })

    test('strips the markers when the selection itself includes them', () => {
      const content = 'Hello **world** end'
      const start = content.indexOf('**')
      const end = start + '**world**'.length

      const result = applyMarkdownFormat('bold', content, { start, end })

      expect(result.content).toBe('Hello world end')
      expect(result.content.slice(result.selectionStart, result.selectionEnd)).toBe('world')
      expect(result.selectionStart).toBe(6)
      expect(result.selectionEnd).toBe(11)
    })

    test('strips the markers when they immediately surround the selection', () => {
      const content = 'Hello **world** end'
      const start = content.indexOf('world')
      const end = start + 'world'.length

      const result = applyMarkdownFormat('bold', content, { start, end })

      expect(result.content).toBe('Hello world end')
      expect(result.content.slice(result.selectionStart, result.selectionEnd)).toBe('world')
      expect(result.selectionStart).toBe(6)
      expect(result.selectionEnd).toBe(11)
    })

    test('inserts a marker pair with the cursor between them for a collapsed selection', () => {
      const content = 'Hello world'
      const cursor = 'Hello '.length

      const result = applyMarkdownFormat('bold', content, { start: cursor, end: cursor })

      expect(result.content).toBe('Hello ****world')
      expect(result.selectionStart).toBe(8)
      expect(result.selectionEnd).toBe(8)
    })
  })

  describe('italic', () => {
    test('wraps a plain selection in * markers and keeps the text selected', () => {
      const content = 'Hello world'
      const result = applyMarkdownFormat('italic', content, { start: 0, end: 'Hello'.length })

      expect(result.content).toBe('*Hello* world')
      expect(result.content.slice(result.selectionStart, result.selectionEnd)).toBe('Hello')
      expect(result.selectionStart).toBe(1)
      expect(result.selectionEnd).toBe(6)
    })
  })

  describe('heading', () => {
    test('adds an H2 prefix to the line the (collapsed) cursor is on, leaving other lines alone, and preserves the caret position within the text', () => {
      const content = 'Line1\nLine2\nLine3'
      const cursor = content.indexOf('Line2') + 2

      const result = applyMarkdownFormat('heading', content, { start: cursor, end: cursor })

      expect(result.content).toBe('Line1\n## Line2\nLine3')
      // Cursor was 2 chars into "Line2" (between "Li" and "ne2"); after adding the 3-char
      // prefix it should still sit 2 chars into "Line2".
      expect(result.selectionStart).toBe(result.selectionEnd)
      expect(result.selectionStart).toBe(content.indexOf('Line2') + '## '.length + 2)
    })

    test('cycles H2 -> H3 when the whole spanned line is already H2, preserving the caret', () => {
      const content = 'Line1\n## Line2\nLine3'
      const cursor = content.indexOf('## Line2') + 3

      const result = applyMarkdownFormat('heading', content, { start: cursor, end: cursor })

      expect(result.content).toBe('Line1\n### Line2\nLine3')
      // Cursor was right at the start of "Line2" (after "## "); it should land right after
      // the new "### " prefix, i.e. still at the start of "Line2".
      expect(result.selectionStart).toBe(result.selectionEnd)
      expect(result.selectionStart).toBe(result.content.indexOf('Line2'))
    })

    test('cycles H3 -> none when the whole spanned line is already H3', () => {
      const content = 'Line1\n### Line2\nLine3'
      const cursor = content.indexOf('### Line2') + 4

      const result = applyMarkdownFormat('heading', content, { start: cursor, end: cursor })

      expect(result.content).toBe('Line1\nLine2\nLine3')
      expect(result.selectionStart).toBe(result.selectionEnd)
      expect(result.selectionStart).toBe(result.content.indexOf('Line2'))
    })

    test('normalizes mixed heading levels across spanned lines to H2', () => {
      const content = '## Line1\n### Line2'

      const result = applyMarkdownFormat('heading', content, { start: 0, end: content.length })

      expect(result.content).toBe('## Line1\n## Line2')
    })

    test('replaces an existing lower-level heading prefix instead of stacking it, preserving the collapsed caret', () => {
      const content = '# Title\nBody'

      const result = applyMarkdownFormat('heading', content, { start: 2, end: 2 })

      expect(result.content).toBe('## Title\nBody')
      // Cursor was inside the stripped "# " prefix (at index 2, the line-start boundary), so it
      // lands immediately after the new "## " prefix.
      expect(result.selectionStart).toBe(result.selectionEnd)
      expect(result.selectionStart).toBe('## '.length)
    })

    test('treats an undefined selection as a collapsed cursor at the end of the content', () => {
      const content = 'Body text'

      const result = applyMarkdownFormat('heading', content, undefined)

      expect(result.content).toBe('## Body text')
      expect(result.selectionStart).toBe(result.selectionEnd)
      expect(result.selectionStart).toBe(content.length + '## '.length)
    })
  })

  describe('quote', () => {
    test('toggles a > prefix on and back off across multiple spanned lines, round-tripping the original selection', () => {
      const content = 'Line1\nLine2\nLine3'

      // Selection ends partway through the second line (after "Li", before "ne2").
      const added = applyMarkdownFormat('quote', content, { start: 0, end: 8 })
      expect(added.content).toBe('> Line1\n> Line2\nLine3')
      // The end was strictly inside line 2 (past its stripped/added-prefix boundary), so it
      // shifts by the two lines' combined prefix delta; the start sat exactly at line 1's
      // start, so it lands right after line 1's new prefix.
      expect(added.selectionStart).toBe(2)
      expect(added.selectionEnd).toBe(12)

      // Applying quote again with the mapped selection removes the prefixes and maps back to
      // exactly the original selection.
      const removed = applyMarkdownFormat('quote', added.content, {
        start: added.selectionStart,
        end: added.selectionEnd,
      })
      expect(removed.content).toBe(content)
      expect(removed.selectionStart).toBe(0)
      expect(removed.selectionEnd).toBe(8)
    })

    test('preserves a collapsed caret mid-line when adding the prefix', () => {
      const content = 'hello'
      const cursor = 2

      const result = applyMarkdownFormat('quote', content, { start: cursor, end: cursor })

      expect(result.content).toBe('> hello')
      expect(result.selectionStart).toBe(4)
      expect(result.selectionEnd).toBe(4)
    })

    test('preserves a collapsed caret mid-line when removing the prefix', () => {
      const content = '> hello'
      const cursor = 4

      const result = applyMarkdownFormat('quote', content, { start: cursor, end: cursor })

      expect(result.content).toBe('hello')
      expect(result.selectionStart).toBe(2)
      expect(result.selectionEnd).toBe(2)
    })

    test('clamps a caret inside the removed prefix to the line start', () => {
      const content = '> hello'
      const cursor = 1

      const result = applyMarkdownFormat('quote', content, { start: cursor, end: cursor })

      expect(result.content).toBe('hello')
      expect(result.selectionStart).toBe(0)
      expect(result.selectionEnd).toBe(0)
    })

    test('maps a whole-content selection spanning two lines through the added prefixes', () => {
      const content = 'aa\nbb'

      const result = applyMarkdownFormat('quote', content, { start: 0, end: 5 })

      expect(result.content).toBe('> aa\n> bb')
      // The start sat at line 1's start, landing right after its new prefix; the end sat at
      // the end of the content, so it sweeps in line 2's new prefix as well.
      expect(result.selectionStart).toBe(2)
      expect(result.selectionEnd).toBe(9)
      expect(result.content.slice(result.selectionStart, result.selectionEnd)).toBe('aa\n> bb')
    })
  })

  describe('unorderedList', () => {
    test('toggles a - prefix on and back off across multiple spanned lines', () => {
      const content = 'Item1\nItem2'

      const added = applyMarkdownFormat('unorderedList', content, { start: 0, end: content.length })
      expect(added.content).toBe('- Item1\n- Item2')
      // The start sat exactly at the first line's start, so it lands right after that line's
      // new "- " prefix; the end sat at the very end of the content (not a line start), so it
      // shifts by both lines' combined prefix delta and sweeps in the last line's own prefix.
      expect(added.selectionStart).toBe(2)
      expect(added.selectionEnd).toBe(added.content.length)

      const removed = applyMarkdownFormat('unorderedList', added.content, {
        start: added.selectionStart,
        end: added.selectionEnd,
      })
      expect(removed.content).toBe(content)
      expect(removed.selectionStart).toBe(0)
      expect(removed.selectionEnd).toBe(content.length)
    })

    test('preserves a collapsed mid-line caret across add/remove', () => {
      const content = 'apple'
      const cursor = 3

      const added = applyMarkdownFormat('unorderedList', content, { start: cursor, end: cursor })
      expect(added.content).toBe('- apple')
      expect(added.selectionStart).toBe(5)
      expect(added.selectionEnd).toBe(5)

      const removed = applyMarkdownFormat('unorderedList', added.content, {
        start: added.selectionStart,
        end: added.selectionEnd,
      })
      expect(removed.content).toBe(content)
      expect(removed.selectionStart).toBe(3)
      expect(removed.selectionEnd).toBe(3)
    })
  })

  describe('orderedList', () => {
    test('numbers spanned lines sequentially, then toggles the numbering back off, mapping a whole-content selection to the same text', () => {
      const content = 'Apple\nBanana\nCherry'

      const added = applyMarkdownFormat('orderedList', content, { start: 0, end: content.length })
      expect(added.content).toBe('1. Apple\n2. Banana\n3. Cherry')
      // The start sat at the first line's start, landing right after its new "1. " prefix; the
      // end sat at the very end of the content, sweeping in the last line's own new prefix.
      expect(added.selectionStart).toBe('1. '.length)
      expect(added.selectionEnd).toBe(added.content.length)

      const removed = applyMarkdownFormat('orderedList', added.content, {
        start: added.selectionStart,
        end: added.selectionEnd,
      })
      expect(removed.content).toBe(content)
      expect(removed.selectionStart).toBe(0)
      expect(removed.selectionEnd).toBe(content.length)
    })

    test('renumbers a stale numbered line within a mixed selection, shifting the endpoint by the combined prefix delta', () => {
      // Only line 1 is numbered, so not every spanned line matches the pattern: this takes the
      // renumber branch (rather than the single-line "already numbered" toggle-off branch),
      // stripping the stale "15. " (4 chars) and replacing it with the correct "2. " (3 chars).
      const content = 'Fig\n15. Cherry'
      const end = content.indexOf('Cherry')

      const result = applyMarkdownFormat('orderedList', content, { start: 0, end })

      expect(result.content).toBe('1. Fig\n2. Cherry')
      // Start sat at line 1's start, landing right after its new "1. " prefix (+3).
      expect(result.selectionStart).toBe('1. '.length)
      // End sat right at the boundary after the stale "15. " prefix on line 2, so it lands
      // right after line 2's new "2. " prefix: shifted by line 1's added prefix (+3) plus line
      // 2's own prefix length delta ("2. " is 1 char shorter than "15. ").
      expect(result.selectionEnd).toBe(result.content.indexOf('Cherry'))
    })

    test('preserves a caret positioned mid-word on an already-numbered line that gets renumbered', () => {
      // Line 2 is already numbered ("9. "), but line 1 isn't, so the selection still takes the
      // renumber branch. The caret sits 2 chars into "Banana" ("Ba|nana"); after "9. " (3 chars)
      // is replaced with "2. " (also 3 chars, since it's the second spanned line), the relative
      // offset into "Banana" should be unchanged.
      const content = 'Apple\n9. Banana'
      const cursor = content.indexOf('Banana') + 2

      const result = applyMarkdownFormat('orderedList', content, { start: 0, end: cursor })

      expect(result.content).toBe('1. Apple\n2. Banana')
      expect(result.selectionEnd).toBe(result.content.indexOf('Banana') + 2)
    })
  })

  describe('horizontalRule', () => {
    test('inserts a rule block into empty content', () => {
      const content = ''

      const result = applyMarkdownFormat('horizontalRule', content, { start: 0, end: 0 })

      expect(result.content).toBe('---\n\n')
      expect(result.selectionStart).toBe(5)
      expect(result.selectionEnd).toBe(5)
    })

    test('inserts a rule block after text when the caret is at the end', () => {
      const content = 'foo'
      const cursor = content.length

      const result = applyMarkdownFormat('horizontalRule', content, {
        start: cursor,
        end: cursor,
      })

      expect(result.content).toBe('foo\n\n---\n\n')
      expect(result.selectionStart).toBe(10)
      expect(result.selectionEnd).toBe(10)
    })

    test('inserts a rule block mid-content, keeping the following text on its own paragraph', () => {
      const content = 'foo\n\nbar'
      const cursor = 3

      const result = applyMarkdownFormat('horizontalRule', content, {
        start: cursor,
        end: cursor,
      })

      expect(result.content).toBe('foo\n\n---\n\nbar')
      expect(result.selectionStart).toBe(10)
      expect(result.selectionEnd).toBe(10)
    })

    test('inserts at the selection end and leaves the selected text intact', () => {
      const content = 'foo bar'
      const start = 0
      const end = 3 // selects "foo"

      const result = applyMarkdownFormat('horizontalRule', content, { start, end })

      expect(result.content).toBe('foo\n\n---\n\nbar')
      // The originally-selected text ("foo") is unmodified and still present verbatim.
      expect(result.content.slice(0, 3)).toBe('foo')
      expect(result.selectionStart).toBe(result.selectionEnd)
      expect(result.selectionStart).toBe(10)
    })

    test('treats an undefined selection as a collapsed cursor at the end of the content', () => {
      const content = 'foo'

      const result = applyMarkdownFormat('horizontalRule', content, undefined)

      expect(result.content).toBe('foo\n\n---\n\n')
      expect(result.selectionStart).toBe(10)
      expect(result.selectionEnd).toBe(10)
    })
  })

  describe('link', () => {
    test('wraps plain selected text as link text and selects the url placeholder', () => {
      const content = 'Check this out'
      const start = content.indexOf('this')
      const end = start + 'this'.length

      const result = applyMarkdownFormat('link', content, { start, end })

      expect(result.content).toBe('Check [this](url) out')
      expect(result.content.slice(result.selectionStart, result.selectionEnd)).toBe('url')
    })

    test('uses a selected URL as the link target and selects the link text placeholder', () => {
      const content = 'See https://example.com here'
      const start = content.indexOf('https://')
      const end = start + 'https://example.com'.length

      const result = applyMarkdownFormat('link', content, { start, end })

      expect(result.content).toBe('See [link text](https://example.com) here')
      expect(result.content.slice(result.selectionStart, result.selectionEnd)).toBe('link text')
    })

    test('inserts a full link placeholder and selects the link text for a collapsed cursor', () => {
      const content = 'Hello world'
      const cursor = content.length

      const result = applyMarkdownFormat('link', content, { start: cursor, end: cursor })

      expect(result.content).toBe('Hello world[link text](url)')
      expect(result.content.slice(result.selectionStart, result.selectionEnd)).toBe('link text')
    })
  })

  test('treats an undefined selection as a collapsed cursor at the end of the content', () => {
    const content = 'Hello'

    const result = applyMarkdownFormat('bold', content, undefined)

    expect(result.content).toBe('Hello****')
    expect(result.selectionStart).toBe(7)
    expect(result.selectionEnd).toBe(7)
  })
})
