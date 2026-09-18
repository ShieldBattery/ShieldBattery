// i18next-cli plugin that extracts translation keys from the Rust game DLL sources.
//
// i18next-cli only parses JavaScript/TypeScript itself, so the in-game UI's strings are collected
// here in the `onEnd` hook and added to the `game` namespace. Only two macro forms are recognized,
// and both take string *literals* for the key and the default text so extraction stays static:
//
//   tr!("game.menu.leave", "Leave game")
//   tr!("game.chat.sentTo", "Sent to {{target}}", target = name)      // args after the default
//   tr_plural!("game.lobby.openSlots", count, one = "{{count}} slot open", other = "{{count}} slots open")
//
// A `tr_plural!` becomes the `key_one` / `key_other` pair i18next uses for English; the
// translation tooling derives every other language's forms from those. A macro whose key or text
// isn't a plain literal (concatenation, a variable, a `format!`) is an error, so a key that the
// extractor can't see never silently ships untranslated.
//
// String literals are read the way Rust reads them: `"..."` with `\"`, `\\`, `\n`, `\t`, `\r`,
// `\0`, `\'`, `\xNN`, `\u{XXXX}` and line-continuation (`\` + newline + leading whitespace)
// escapes, and raw strings `r"..."` / `r#"..."#` (byte-string prefixes too). Macros inside
// comments, other string literals, or character literals are ignored.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const NAMESPACE = 'game'
const MACROS = new Set(['tr', 'tr_plural'])
const DIRS_TO_SKIP = new Set(['target', 'node_modules', '.git'])

/**
 * @param {object} [options]
 * @param {string[]} [options.roots] directories to scan recursively for `.rs` files, relative to
 *   the working directory; defaults to `['game']`
 */
export function rustTranslations(options = {}) {
  const roots = options.roots ?? ['game']
  return {
    name: 'rust-translations',
    async onEnd(keys) {
      const files = []
      for (const root of roots) {
        await collectRustFiles(path.resolve(root), files)
      }
      files.sort()
      for (const file of files) {
        const source = await readFile(file, 'utf8')
        for (const entry of extractFromSource(source, file)) {
          keys.set(`${NAMESPACE}:${entry.key}`, {
            key: entry.key,
            defaultValue: entry.defaultValue,
            ns: NAMESPACE,
          })
        }
      }
    },
  }
}

async function collectRustFiles(dir, out) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!DIRS_TO_SKIP.has(entry.name)) {
        await collectRustFiles(path.join(dir, entry.name), out)
      }
    } else if (entry.name.endsWith('.rs')) {
      out.push(path.join(dir, entry.name))
    }
  }
}

/**
 * Extracts every `tr!` / `tr_plural!` invocation from one Rust source file.
 *
 * @param {string} source
 * @param {string} file used for error messages
 * @returns {Array<{ key: string, defaultValue: string }>}
 */
export function extractFromSource(source, file) {
  const results = []
  const scanner = new Scanner(source, file)
  while (!scanner.atEnd()) {
    scanner.skipTrivia()
    if (scanner.atEnd()) break

    const ident = scanner.tryReadIdentifier()
    if (ident === undefined) {
      if (scanner.peek() === '"' || scanner.startsRawString()) {
        // Skip over string literals so a macro name inside one isn't mistaken for a call.
        scanner.readStringLiteral()
      } else if (!scanner.skipCharLiteralIfAny()) {
        scanner.advance(1)
      }
      continue
    }
    if (!MACROS.has(ident)) continue
    if (!scanner.tryConsume('!')) continue
    scanner.skipTrivia()
    if (!scanner.tryConsume('(')) continue

    if (ident === 'tr') {
      const key = scanner.expectStringLiteral(`${ident}! key`)
      scanner.skipTrivia()
      scanner.expectConsume(',', `after the key of ${ident}!`)
      const defaultValue = scanner.expectStringLiteral(`${ident}! default text`)
      results.push({ key, defaultValue })
    } else {
      const key = scanner.expectStringLiteral(`${ident}! key`)
      scanner.skipTrivia()
      scanner.expectConsume(',', `after the key of ${ident}!`)
      scanner.skipBalancedUntilComma(`the count expression of ${ident}!`)
      const forms = {}
      for (const form of ['one', 'other']) {
        scanner.skipTrivia()
        const name = scanner.tryReadIdentifier()
        if (name !== form) {
          scanner.fail(
            `expected \`${form} = "..."\` in ${ident}!, found ${JSON.stringify(name ?? scanner.peek())}`,
          )
        }
        scanner.skipTrivia()
        scanner.expectConsume('=', `after \`${form}\` in ${ident}!`)
        forms[form] = scanner.expectStringLiteral(`${ident}! ${form} text`)
        if (form === 'one') {
          scanner.skipTrivia()
          scanner.expectConsume(',', `between the plural forms of ${ident}!`)
        }
      }
      results.push({ key: `${key}_one`, defaultValue: forms.one })
      results.push({ key: `${key}_other`, defaultValue: forms.other })
    }
    // The remaining arguments (interpolation values) are ordinary Rust expressions; leave them to
    // the outer loop, which skips anything that isn't a macro call.
  }
  return results
}

class Scanner {
  constructor(source, file) {
    this.source = source
    this.file = file
    this.pos = 0
  }

  atEnd() {
    return this.pos >= this.source.length
  }

  peek(offset = 0) {
    return this.source[this.pos + offset]
  }

  advance(count) {
    this.pos += count
  }

  location() {
    const upTo = this.source.slice(0, this.pos)
    const line = upTo.split('\n').length
    const column = this.pos - upTo.lastIndexOf('\n')
    return `${this.file}:${line}:${column}`
  }

  fail(message) {
    throw new Error(`${this.location()}: ${message}`)
  }

  /** Skips whitespace and comments (line, block, and nested block comments as Rust allows). */
  skipTrivia() {
    for (;;) {
      const c = this.peek()
      if (c === undefined) return
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        this.advance(1)
      } else if (c === '/' && this.peek(1) === '/') {
        const end = this.source.indexOf('\n', this.pos)
        this.pos = end === -1 ? this.source.length : end + 1
      } else if (c === '/' && this.peek(1) === '*') {
        let depth = 0
        do {
          if (this.peek() === '/' && this.peek(1) === '*') {
            depth++
            this.advance(2)
          } else if (this.peek() === '*' && this.peek(1) === '/') {
            depth--
            this.advance(2)
          } else if (this.atEnd()) {
            this.fail('unterminated block comment')
          } else {
            this.advance(1)
          }
        } while (depth > 0)
      } else {
        return
      }
    }
  }

  tryReadIdentifier() {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.source.slice(this.pos, this.pos + 64))
    if (!match) return undefined
    // A raw string prefix (`r"` / `r#"`) is not an identifier.
    if (this.startsRawString()) return undefined
    this.advance(match[0].length)
    return match[0]
  }

  tryConsume(text) {
    if (this.source.startsWith(text, this.pos)) {
      this.advance(text.length)
      return true
    }
    return false
  }

  expectConsume(text, context) {
    if (!this.tryConsume(text)) {
      this.fail(
        `expected \`${text}\` ${context}, found ${JSON.stringify(this.peek() ?? 'end of file')}`,
      )
    }
  }

  /** Whether a raw string (`r"…"`, `r#"…"#`, or the byte-string forms `br"…"`) starts here. */
  startsRawString() {
    return /^b?r#*"/.test(this.source.slice(this.pos, this.pos + 8))
  }

  /**
   * Skips a character literal (`'a'`, `'\n'`, `'"'`, `'\u{1F600}'`) if one starts here, so a quote
   * inside it can't be mistaken for the start of a string. A lone `'` that begins a lifetime
   * (`'a`) is left alone.
   */
  skipCharLiteralIfAny() {
    if (this.peek() !== "'") return false
    const match = /^'(?:[^'\\\n]|\\(?:[nrt0\\'"]|x[0-7][0-9A-Fa-f]|u\{[0-9A-Fa-f]{1,6}\}))'/u.exec(
      this.source.slice(this.pos, this.pos + 16),
    )
    if (!match) return false
    this.advance(match[0].length)
    return true
  }

  expectStringLiteral(context) {
    this.skipTrivia()
    if (this.peek() !== '"' && !this.startsRawString()) {
      this.fail(
        `${context} must be a string literal, found ${JSON.stringify(this.peek() ?? 'end of file')}`,
      )
    }
    return this.readStringLiteral()
  }

  /** Reads a `"..."` or `r#"..."#` literal at the current position and returns its value. */
  readStringLiteral() {
    if (this.startsRawString()) {
      if (this.peek() === 'b') this.advance(1)
      this.advance(1) // the `r`
      let hashes = 0
      while (this.peek() === '#') {
        hashes++
        this.advance(1)
      }
      this.advance(1) // opening quote
      const terminator = '"' + '#'.repeat(hashes)
      const end = this.source.indexOf(terminator, this.pos)
      if (end === -1) this.fail('unterminated raw string literal')
      const value = this.source.slice(this.pos, end)
      this.pos = end + terminator.length
      return value
    }

    this.advance(1) // opening quote
    let value = ''
    for (;;) {
      const c = this.peek()
      if (c === undefined) this.fail('unterminated string literal')
      if (c === '"') {
        this.advance(1)
        return value
      }
      if (c !== '\\') {
        value += c
        this.advance(1)
        continue
      }
      const e = this.peek(1)
      switch (e) {
        case 'n':
          value += '\n'
          this.advance(2)
          break
        case 't':
          value += '\t'
          this.advance(2)
          break
        case 'r':
          value += '\r'
          this.advance(2)
          break
        case '0':
          value += '\0'
          this.advance(2)
          break
        case 'x': {
          const match = /^\\x([0-7][0-9A-Fa-f])/.exec(this.source.slice(this.pos, this.pos + 4))
          if (!match) this.fail('malformed \\x escape')
          value += String.fromCharCode(parseInt(match[1], 16))
          this.advance(match[0].length)
          break
        }
        case '\\':
        case '"':
        case "'":
          value += e
          this.advance(2)
          break
        case 'u': {
          const match = /^\\u\{([0-9A-Fa-f]{1,6})\}/.exec(
            this.source.slice(this.pos, this.pos + 12),
          )
          if (!match) this.fail('malformed \\u{...} escape')
          value += String.fromCodePoint(parseInt(match[1], 16))
          this.advance(match[0].length)
          break
        }
        case '\n':
        case '\r': {
          // A backslash before a newline continues the literal on the next line, dropping the
          // newline and the following indentation.
          this.advance(1)
          while (/\s/.test(this.peek() ?? '')) this.advance(1)
          break
        }
        default:
          this.fail(`unsupported escape \\${e} in string literal`)
      }
    }
  }

  /**
   * Skips one Rust expression up to (and including) the next `,` at nesting depth zero, so the
   * count argument of `tr_plural!` may be any expression.
   */
  skipBalancedUntilComma(context) {
    let depth = 0
    for (;;) {
      this.skipTrivia()
      const c = this.peek()
      if (c === undefined) this.fail(`unterminated ${context}`)
      if (c === '"' || this.startsRawString()) {
        this.readStringLiteral()
        continue
      }
      if (this.skipCharLiteralIfAny()) continue
      if (c === '(' || c === '[' || c === '{') depth++
      if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) this.fail(`expected \`,\` after ${context}`)
        depth--
      }
      if (c === ',' && depth === 0) {
        this.advance(1)
        return
      }
      this.advance(1)
    }
  }
}
