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
    test('adds a heading prefix to the line the (collapsed) cursor is on, leaving other lines alone', () => {
      const content = 'Line1\nLine2\nLine3'
      const cursor = content.indexOf('Line2') + 2

      const result = applyMarkdownFormat('heading', content, { start: cursor, end: cursor })

      expect(result.content).toBe('Line1\n## Line2\nLine3')
      expect(result.content.slice(result.selectionStart, result.selectionEnd)).toBe('## Line2')
    })

    test('toggles the prefix back off when the whole spanned line already has it', () => {
      const content = 'Line1\n## Line2\nLine3'
      const cursor = content.indexOf('## Line2') + 3

      const result = applyMarkdownFormat('heading', content, { start: cursor, end: cursor })

      expect(result.content).toBe('Line1\nLine2\nLine3')
      expect(result.content.slice(result.selectionStart, result.selectionEnd)).toBe('Line2')
    })

    test('replaces an existing lower-level heading prefix instead of stacking it', () => {
      const content = '# Title\nBody'

      const result = applyMarkdownFormat('heading', content, { start: 2, end: 2 })

      expect(result.content).toBe('## Title\nBody')
      expect(result.content.slice(result.selectionStart, result.selectionEnd)).toBe('## Title')
    })
  })

  describe('quote', () => {
    test('toggles a > prefix on and back off across multiple spanned lines', () => {
      const content = 'Line1\nLine2\nLine3'

      const added = applyMarkdownFormat('quote', content, { start: 0, end: 8 })
      expect(added.content).toBe('> Line1\n> Line2\nLine3')

      const removed = applyMarkdownFormat('quote', added.content, {
        start: added.selectionStart,
        end: added.selectionEnd,
      })
      expect(removed.content).toBe(content)
      expect(removed.selectionStart).toBe(0)
      expect(removed.selectionEnd).toBe('Line1\nLine2'.length)
    })
  })

  describe('unorderedList', () => {
    test('toggles a - prefix on and back off across multiple spanned lines', () => {
      const content = 'Item1\nItem2'

      const added = applyMarkdownFormat('unorderedList', content, { start: 0, end: content.length })
      expect(added.content).toBe('- Item1\n- Item2')

      const removed = applyMarkdownFormat('unorderedList', added.content, {
        start: added.selectionStart,
        end: added.selectionEnd,
      })
      expect(removed.content).toBe(content)
      expect(removed.selectionStart).toBe(0)
      expect(removed.selectionEnd).toBe(content.length)
    })
  })

  describe('orderedList', () => {
    test('numbers spanned lines sequentially, then toggles the numbering back off', () => {
      const content = 'Apple\nBanana\nCherry'

      const added = applyMarkdownFormat('orderedList', content, { start: 0, end: content.length })
      expect(added.content).toBe('1. Apple\n2. Banana\n3. Cherry')

      const removed = applyMarkdownFormat('orderedList', added.content, {
        start: added.selectionStart,
        end: added.selectionEnd,
      })
      expect(removed.content).toBe(content)
      expect(removed.selectionStart).toBe(0)
      expect(removed.selectionEnd).toBe(content.length)
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
