/**
 * Deterministic helper for agent-driven translation of our i18next locale files.
 *
 * This script owns all the *mechanical* work so an LLM never has to touch JSON structure:
 *   - finding keys present in `en` but missing in a target language (plural-aware)
 *   - finding orphan keys present in a target language but no longer in `en`
 *   - validating that translations preserve `{{interpolations}}` and `<0>` Trans tags
 *   - merging translated values back in, then re-sorting/re-formatting to match the
 *     output `i18next-parser` produces for `en` (2-space indent, LF, alphabetical sort)
 *
 * The agent's only job is to produce translation *values*; everything else is here so it's
 * reproducible and can't silently corrupt a file.
 *
 * Plural categories are resolved from `Intl.PluralRules` (the same CLDR data i18next uses at
 * runtime), so each language gets exactly the plural forms it needs — `es` => one/many/other,
 * `ru` => one/few/many/other, `ko`/`zh-Hans` => other only.
 *
 * Usage (run from repo root):
 *   pnpm run i18n status                       # overview of missing/orphan counts per language
 *   pnpm run i18n plan <lang> [outFile]        # write the to-translate work list (JSON)
 *   pnpm run i18n apply <lang> <resultFile>    # validate + merge translations for missing keys
 *   pnpm run i18n fix <lang> <resultFile>      # validate + overwrite existing translations (quality fixes)
 *   pnpm run i18n terms <lang> <query>         # look up Blizzard-matched glossary terms
 *   pnpm run i18n stale [lang] [outFile]       # find translations whose English source changed (--since <ref>)
 *   pnpm run i18n prune <lang>                 # delete orphan keys no longer present in `en`
 *   pnpm run i18n normalize <lang>             # reformat (indent/sort) to match `en`, no content change
 *   pnpm run i18n check <lang>                 # read-only audit (orphans, plurals, token drift)
 *
 * Languages come from common/i18n.ts (`en` is the source and is never a target).
 */

import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { ALL_TRANSLATION_LANGUAGES, TranslationLanguage } from '../common/i18n'

const SOURCE_LANG = TranslationLanguage.English
const REPO_ROOT = path.resolve(__dirname, '..')
const LOCALES_DIR = path.join(REPO_ROOT, 'server', 'public', 'locales')
const NAMESPACE = 'global'

/** Blizzard-matched terminology glossaries (CSV per language), used by the `terms` command. */
const TERMS_DIR = path.join(REPO_ROOT, '.claude', 'skills', 'translate-i18n', 'terms')

const TARGET_LANGUAGES = ALL_TRANSLATION_LANGUAGES.filter(l => l !== SOURCE_LANG)

/** All possible CLDR cardinal plural suffixes, used to recognize plural keys. */
const ALL_PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const
type PluralCategory = (typeof ALL_PLURAL_CATEGORIES)[number]

type LocaleObject = { [key: string]: string | LocaleObject }

// --- File IO -----------------------------------------------------------------

function localePath(lang: string): string {
  return path.join(LOCALES_DIR, lang, `${NAMESPACE}.json`)
}

function readLocale(lang: string): LocaleObject {
  return JSON.parse(fs.readFileSync(localePath(lang), 'utf8')) as LocaleObject
}

/**
 * Reproduces `i18next-parser`'s default key sort (see `makeDefaultSort` in its helpers) so our
 * output ordering matches what `pnpm gen-translations` produces. Keys are compared by their
 * singular form via `localeCompare(_, 'en')`; plural variants that share a singular form are ordered
 * by canonical plural-suffix position (zero < one < two < few < many < other).
 */
const PLURAL_SUFFIX_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other']
const SINGULAR_FORM_RE = /_(?:zero|one|two|few|many|other)$/

function getSingularForm(key: string): string {
  return key.replace(SINGULAR_FORM_RE, '')
}

function getPluralSuffixPosition(key: string): number {
  return PLURAL_SUFFIX_ORDER.findIndex(suffix => key.endsWith(suffix))
}

function compareKeys(a: string, b: string): number {
  const singularA = getSingularForm(a)
  const singularB = getSingularForm(b)
  if (singularA === singularB) {
    return getPluralSuffixPosition(a) - getPluralSuffixPosition(b)
  }
  return singularA.localeCompare(singularB, 'en')
}

/**
 * Recursively sorts object keys (matching i18next-parser) and serializes with 2-space indent + a
 * trailing newline. This reproduces what `i18next-parser` (sort: true, lineEnding: lf) writes for
 * `en`, so applying changes never reformats the whole file.
 */
function serializeLocale(obj: LocaleObject): string {
  const sortRec = (value: string | LocaleObject): string | LocaleObject => {
    if (typeof value === 'string') return value
    const out: LocaleObject = {}
    for (const key of Object.keys(value).sort(compareKeys)) {
      out[key] = sortRec(value[key])
    }
    return out
  }
  return JSON.stringify(sortRec(obj), null, 2) + '\n'
}

function writeLocale(lang: string, obj: LocaleObject): void {
  fs.writeFileSync(localePath(lang), serializeLocale(obj), 'utf8')
}

// --- Flatten / unflatten -----------------------------------------------------

function flatten(
  obj: LocaleObject,
  prefix = '',
  out = new Map<string, string>(),
): Map<string, string> {
  for (const [key, value] of Object.entries(obj)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      out.set(dotted, value)
    } else {
      flatten(value, dotted, out)
    }
  }
  return out
}

function setDeep(obj: LocaleObject, dottedKey: string, value: string): void {
  const parts = dottedKey.split('.')
  let cursor = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (typeof cursor[part] !== 'object' || cursor[part] === null) {
      cursor[part] = {}
    }
    cursor = cursor[part] as LocaleObject
  }
  cursor[parts[parts.length - 1]] = value
}

function deleteDeep(obj: LocaleObject, dottedKey: string): void {
  const parts = dottedKey.split('.')
  const stack: LocaleObject[] = []
  let cursor = obj
  for (let i = 0; i < parts.length - 1; i++) {
    stack.push(cursor)
    const next = cursor[parts[i]]
    if (typeof next !== 'object' || next === null) return
    cursor = next
  }
  delete cursor[parts[parts.length - 1]]
  // Walk back up removing any now-empty objects so we don't leave dangling `{}`.
  for (let i = parts.length - 2; i >= 0; i--) {
    const parent = stack[i]
    const child = parent[parts[i]]
    if (typeof child === 'object' && child !== null && Object.keys(child).length === 0) {
      delete parent[parts[i]]
    } else {
      break
    }
  }
}

// --- Plural handling ---------------------------------------------------------

function pluralCategoriesFor(lang: string): PluralCategory[] {
  const cats = new Intl.PluralRules(lang, { type: 'cardinal' }).resolvedOptions().pluralCategories
  // Keep our canonical ordering for stable output.
  return ALL_PLURAL_CATEGORIES.filter(c => cats.includes(c))
}

/** Splits a flat key into `{ base, category }` if it ends in a plural suffix, else null. */
function splitPlural(key: string): { base: string; category: PluralCategory } | null {
  for (const cat of ALL_PLURAL_CATEGORIES) {
    const suffix = `_${cat}`
    if (key.endsWith(suffix)) {
      return { base: key.slice(0, -suffix.length), category: cat }
    }
  }
  return null
}

/**
 * Identifies plural groups in the source. A base is a real plural group only if `en` has BOTH the
 * `_one` and `_other` forms (English's exact cardinal categories) — this avoids misclassifying an
 * ordinary key that merely ends in e.g. `_other`.
 */
function findSourcePluralBases(enFlat: Map<string, string>): Set<string> {
  const bases = new Set<string>()
  for (const key of enFlat.keys()) {
    const split = splitPlural(key)
    if (split?.category === 'one' && enFlat.has(`${split.base}_other`)) {
      bases.add(split.base)
    }
  }
  return bases
}

// --- Token (interpolation + Trans tag) extraction ----------------------------

/** Extracts the multiset of `{{var}}` interpolations and `<n>`/`</n>` Trans tags from a value. */
function extractTokens(value: string): string[] {
  const tokens = value.match(/\{\{[^}]+\}\}|<\/?[^>]+>/g) ?? []
  return tokens.slice().sort()
}

function tokensEqual(a: string, b: string): boolean {
  const ta = extractTokens(a)
  const tb = extractTokens(b)
  return ta.length === tb.length && ta.every((t, i) => t === tb[i])
}

// --- Plan / diff -------------------------------------------------------------

interface SingleItem {
  key: string
  type: 'single'
  en: string
}
interface PluralItem {
  key: string
  type: 'plural'
  en: { one?: string; other?: string }
  required: PluralCategory[]
}
type WorkItem = SingleItem | PluralItem

interface Plan {
  lang: string
  pluralCategories: PluralCategory[]
  items: WorkItem[]
}

function computePlan(lang: string): Plan {
  const enFlat = flatten(readLocale(SOURCE_LANG))
  const targetFlat = flatten(readLocale(lang))
  const pluralBases = findSourcePluralBases(enFlat)
  const required = pluralCategoriesFor(lang)

  const items: WorkItem[] = []
  const handledPluralBases = new Set<string>()

  for (const [key, value] of enFlat) {
    const split = splitPlural(key)
    const isPlural = split !== null && pluralBases.has(split.base)

    if (isPlural) {
      const base = split!.base
      if (handledPluralBases.has(base)) continue
      handledPluralBases.add(base)
      // Needs work if the target is missing ANY required plural form for this base.
      const anyMissing = required.some(cat => !targetFlat.has(`${base}_${cat}`))
      if (anyMissing) {
        items.push({
          key: base,
          type: 'plural',
          en: { one: enFlat.get(`${base}_one`), other: enFlat.get(`${base}_other`) },
          required,
        })
      }
    } else {
      // Truly-missing only: a non-plural key absent from the target.
      if (!targetFlat.has(key)) {
        items.push({ key, type: 'single', en: value })
      }
    }
  }

  items.sort((a, b) => a.key.localeCompare(b.key))
  return { lang, pluralCategories: required, items }
}

/** Keys present in the target that no longer correspond to anything in `en` (plural-aware). */
function computeOrphans(lang: string): string[] {
  const enFlat = flatten(readLocale(SOURCE_LANG))
  const targetFlat = flatten(readLocale(lang))
  const pluralBases = findSourcePluralBases(enFlat)
  const required = new Set(pluralCategoriesFor(lang))

  const orphans: string[] = []
  for (const key of targetFlat.keys()) {
    const split = splitPlural(key)
    if (split && pluralBases.has(split.base)) {
      // Valid only if this plural form is one the language actually uses.
      if (!required.has(split.category)) orphans.push(key)
    } else if (!enFlat.has(key)) {
      orphans.push(key)
    }
  }
  orphans.sort()
  return orphans
}

// --- Commands ----------------------------------------------------------------

function cmdStatus(): void {
  const enFlat = flatten(readLocale(SOURCE_LANG))
  console.log(`Source (${SOURCE_LANG}): ${enFlat.size} keys\n`)
  console.log('lang      to-translate   orphans   plural-forms')
  console.log('--------  ------------   -------   ------------')
  for (const lang of TARGET_LANGUAGES) {
    const plan = computePlan(lang)
    const orphans = computeOrphans(lang)
    const forms = pluralCategoriesFor(lang).join('/')
    console.log(
      `${lang.padEnd(8)}  ${String(plan.items.length).padEnd(12)}   ${String(orphans.length).padEnd(7)}   ${forms}`,
    )
  }
}

function cmdPlan(lang: string, outFile?: string): void {
  assertTargetLang(lang)
  const plan = computePlan(lang)
  const json = JSON.stringify(plan, null, 2)
  if (outFile) {
    fs.writeFileSync(outFile, json + '\n', 'utf8')
    console.log(`Wrote ${plan.items.length} work item(s) for "${lang}" to ${outFile}`)
  } else {
    console.log(json)
  }
}

interface ResultFile {
  translations: { [key: string]: string | { [cat: string]: string } }
}

function cmdApply(lang: string, resultFile: string): void {
  assertTargetLang(lang)
  const plan = computePlan(lang)
  const planByKey = new Map(plan.items.map(item => [item.key, item]))
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as ResultFile

  const errors: string[] = []
  const additions: Array<{ key: string; value: string }> = []

  for (const [key, value] of Object.entries(result.translations ?? {})) {
    const item = planByKey.get(key)
    if (!item) {
      errors.push(`"${key}": not in the to-translate plan (already translated or unknown key)`)
      continue
    }

    if (item.type === 'single') {
      if (typeof value !== 'string') {
        errors.push(`"${key}": expected a string value`)
        continue
      }
      if (!tokensEqual(item.en, value)) {
        errors.push(
          `"${key}": interpolation/tag mismatch — en has [${extractTokens(item.en).join(', ')}], translation has [${extractTokens(value).join(', ')}]`,
        )
        continue
      }
      additions.push({ key, value })
    } else {
      if (typeof value !== 'object' || value === null) {
        errors.push(`"${key}": plural key expects an object of { ${item.required.join(', ')} }`)
        continue
      }
      const reference = item.en.other ?? item.en.one ?? ''
      for (const cat of item.required) {
        const form = (value as Record<string, string>)[cat]
        if (typeof form !== 'string') {
          errors.push(`"${key}": missing required plural form "${cat}"`)
          continue
        }
        if (!tokensEqual(reference, form)) {
          errors.push(
            `"${key}" (${cat}): interpolation/tag mismatch — en has [${extractTokens(reference).join(', ')}], translation has [${extractTokens(form).join(', ')}]`,
          )
          continue
        }
        additions.push({ key: `${key}_${cat}`, value: form })
      }
      const extra = Object.keys(value).filter(c => !item.required.includes(c as PluralCategory))
      if (extra.length) {
        errors.push(
          `"${key}": unexpected plural form(s) [${extra.join(', ')}] (language uses ${item.required.join('/')})`,
        )
      }
    }
  }

  if (errors.length) {
    console.error(`Validation failed — nothing written. ${errors.length} error(s):`)
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }

  const target = readLocale(lang)
  for (const { key, value } of additions) {
    setDeep(target, key, value)
  }
  writeLocale(lang, target)
  console.log(
    `Applied ${additions.length} value(s) to "${lang}". ${planByKey.size - countTranslatedItems(result, plan)} work item(s) still remaining.`,
  )
}

function countTranslatedItems(result: ResultFile, plan: Plan): number {
  const keys = new Set(Object.keys(result.translations ?? {}))
  return plan.items.filter(item => keys.has(item.key)).length
}

function cmdPrune(lang: string): void {
  assertTargetLang(lang)
  const orphans = computeOrphans(lang)
  if (!orphans.length) {
    console.log(`No orphan keys in "${lang}".`)
    return
  }
  const target = readLocale(lang)
  for (const key of orphans) deleteDeep(target, key)
  writeLocale(lang, target)
  console.log(`Deleted ${orphans.length} orphan key(s) from "${lang}":`)
  for (const key of orphans) console.log(`  - ${key}`)
}

function cmdNormalize(lang: string): void {
  assertTargetLang(lang)
  const before = fs.readFileSync(localePath(lang), 'utf8')
  const after = serializeLocale(readLocale(lang))
  if (before === after) {
    console.log(`"${lang}" already normalized.`)
    return
  }
  fs.writeFileSync(localePath(lang), after, 'utf8')
  console.log(
    `Normalized "${lang}" formatting (indent/sort) to match the parser output for \`en\`.`,
  )
}

function cmdCheck(lang: string): void {
  assertTargetLang(lang)
  const plan = computePlan(lang)
  const orphans = computeOrphans(lang)

  // Token drift in *existing* translations (catches past MT mistakes too).
  const enFlat = flatten(readLocale(SOURCE_LANG))
  const targetFlat = flatten(readLocale(lang))
  const drift: string[] = []
  for (const [key, value] of targetFlat) {
    const en = enFlat.get(key)
    if (en !== undefined && !tokensEqual(en, value)) {
      drift.push(
        `  - ${key}: en [${extractTokens(en).join(', ')}] vs ${lang} [${extractTokens(value).join(', ')}]`,
      )
    }
  }

  // Formatting normalization check.
  const current = fs.readFileSync(localePath(lang), 'utf8')
  const normalized = serializeLocale(readLocale(lang))
  const formatOk = current === normalized

  console.log(`Check for "${lang}":`)
  console.log(`  to-translate:   ${plan.items.length}`)
  console.log(`  orphans:        ${orphans.length}`)
  console.log(`  token drift:    ${drift.length}`)
  console.log(
    `  format normalized: ${formatOk ? 'yes' : 'NO (run apply/prune to normalize, or re-sort)'}`,
  )
  if (drift.length) {
    console.log('\nToken drift detail:')
    for (const d of drift) console.log(d)
  }
  const clean = plan.items.length === 0 && orphans.length === 0 && drift.length === 0 && formatOk
  console.log(`\n${clean ? '✓ clean' : '✗ work remaining'}`)
  if (!clean) process.exitCode = 1
}

/**
 * Overwrites *existing* translations (register/wording/quality fixes) through the same token
 * validation + reformat as `apply`, so corrections don't need raw hand-edits. Use `apply` for new
 * (missing) keys; use `fix` to change keys that are already translated.
 */
function cmdFix(lang: string, resultFile: string): void {
  assertTargetLang(lang)
  const enFlat = flatten(readLocale(SOURCE_LANG))
  const targetFlat = flatten(readLocale(lang))
  const pluralBases = findSourcePluralBases(enFlat)
  const required = pluralCategoriesFor(lang)
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as ResultFile

  const errors: string[] = []
  const changes: Array<{ key: string; from: string | undefined; to: string }> = []

  for (const [key, value] of Object.entries(result.translations ?? {})) {
    if (typeof value === 'string') {
      if (!targetFlat.has(key)) {
        errors.push(`"${key}": not present in "${lang}" (use \`apply\` to add new keys)`)
        continue
      }
      const en = enFlat.get(key)
      if (en !== undefined && !tokensEqual(en, value)) {
        errors.push(
          `"${key}": interpolation/tag mismatch — en has [${extractTokens(en).join(', ')}], translation has [${extractTokens(value).join(', ')}]`,
        )
        continue
      }
      changes.push({ key, from: targetFlat.get(key), to: value })
    } else if (typeof value === 'object' && value !== null) {
      if (!pluralBases.has(key)) {
        errors.push(`"${key}": not a plural base in \`en\` (pass a plural object only for plurals)`)
        continue
      }
      const reference = enFlat.get(`${key}_other`) ?? enFlat.get(`${key}_one`) ?? ''
      for (const cat of required) {
        const form = (value as Record<string, string>)[cat]
        if (typeof form !== 'string') {
          errors.push(`"${key}": missing required plural form "${cat}"`)
          continue
        }
        if (!tokensEqual(reference, form)) {
          errors.push(
            `"${key}" (${cat}): interpolation/tag mismatch — en has [${extractTokens(reference).join(', ')}], translation has [${extractTokens(form).join(', ')}]`,
          )
          continue
        }
        changes.push({ key: `${key}_${cat}`, from: targetFlat.get(`${key}_${cat}`), to: form })
      }
      const extra = Object.keys(value).filter(c => !required.includes(c as PluralCategory))
      if (extra.length) {
        errors.push(
          `"${key}": unexpected plural form(s) [${extra.join(', ')}] (language uses ${required.join('/')})`,
        )
      }
    } else {
      errors.push(`"${key}": expected a string or plural object`)
    }
  }

  if (errors.length) {
    console.error(`Validation failed — nothing written. ${errors.length} error(s):`)
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }

  const target = readLocale(lang)
  for (const { key, to } of changes) {
    setDeep(target, key, to)
  }
  writeLocale(lang, target)
  console.log(`Fixed ${changes.length} value(s) in "${lang}":`)
  for (const { key, from, to } of changes) {
    console.log(from === to ? `  = ${key}: (unchanged)` : `  - ${key}: "${from ?? ''}" → "${to}"`)
  }
}

// --- CSV terms lookup --------------------------------------------------------

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped `""`, embedded commas/newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Looks up Blizzard-matched glossary terms (matches `source` or `target`, case-insensitive). */
function cmdTerms(lang: string, query: string): void {
  assertTargetLang(lang)
  if (!query) {
    console.error('usage: terms <lang> <query>')
    process.exit(1)
  }
  const file = path.join(TERMS_DIR, `${lang}.csv`)
  if (!fs.existsSync(file)) {
    console.error(`No term glossary for "${lang}" at ${path.relative(REPO_ROOT, file)}`)
    process.exit(1)
  }
  const rows = parseCsv(fs.readFileSync(file, 'utf8'))
  if (rows.length < 2) {
    console.log('(empty glossary)')
    return
  }
  const header = rows[0].map(h => h.trim().toLowerCase())
  const srcIdx = header.indexOf('source')
  const tgtIdx = header.indexOf('target')
  const ctxIdx = header.indexOf('context')
  if (srcIdx < 0 || tgtIdx < 0) {
    console.error(`Unexpected CSV columns (need source,target): ${header.join(', ')}`)
    process.exit(1)
  }
  const q = query.toLowerCase()
  const matches = rows
    .slice(1)
    .filter(
      r =>
        (r[srcIdx] ?? '').toLowerCase().includes(q) || (r[tgtIdx] ?? '').toLowerCase().includes(q),
    )
  if (!matches.length) {
    console.log(`No glossary matches for "${query}" in ${lang}.`)
    return
  }
  const LIMIT = 60
  for (const r of matches.slice(0, LIMIT)) {
    const ctx = ctxIdx >= 0 && r[ctxIdx] ? `   [${r[ctxIdx]}]` : ''
    console.log(`  ${r[srcIdx]}  →  ${r[tgtIdx]}${ctx}`)
  }
  if (matches.length > LIMIT) {
    console.log(`  … and ${matches.length - LIMIT} more (refine your query)`)
  }
}

// --- Stale detection (git) ---------------------------------------------------
//
// Finds translations that are present and structurally valid but were made against an OLDER English
// source — i.e. the English wording changed and the target language wasn't re-translated. None of the
// other commands catch this (plan = missing, prune = orphans, check = token drift only). We detect it
// by parsing the JSON at a base git ref and comparing values, so sorting/reformatting is irrelevant.

const LOCALES_REL = 'server/public/locales'

function git(gitArgs: string[]): string {
  return execFileSync('git', gitArgs, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
}

function refExists(ref: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

/** The English source ref to compare against. `--since` is used verbatim; otherwise the merge-base. */
function resolveBaseRef(since: string | undefined): string {
  if (since) {
    if (!refExists(since)) {
      console.error(`--since ref "${since}" doesn't resolve to a commit.`)
      process.exit(1)
    }
    return since
  }
  const mainRef = ['origin/master', 'master', 'origin/main', 'main'].find(refExists)
  if (!mainRef) {
    console.error(
      'Could not find a main branch ref (origin/master, master, …). Pass --since <ref>.',
    )
    process.exit(1)
  }
  try {
    return git(['merge-base', 'HEAD', mainRef])
  } catch {
    return mainRef
  }
}

/** Reads a locale file as it existed at `ref`, or null if it didn't exist there. */
function readLocaleAtRef(lang: string, ref: string): LocaleObject | null {
  try {
    const content = execFileSync(
      'git',
      ['show', `${ref}:${LOCALES_REL}/${lang}/${NAMESPACE}.json`],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    )
    return JSON.parse(content) as LocaleObject
  } catch {
    return null
  }
}

interface StaleSingle {
  key: string
  type: 'single'
  enOld: string
  enNew: string
  current: string
}
interface StalePlural {
  key: string
  type: 'plural'
  enOld: { one?: string; other?: string }
  enNew: { one?: string; other?: string }
  required: PluralCategory[]
  current: { [cat: string]: string }
}
type StaleItem = StaleSingle | StalePlural

/**
 * A key is stale when its English value changed between `baseRef` and now, but the target's value did
 * NOT change over the same range (and the target still has it). Plural groups are reported per base.
 */
function computeStale(lang: string, baseRef: string): StaleItem[] {
  const enBase = flatten(readLocaleAtRef(SOURCE_LANG, baseRef) ?? {})
  const enNow = flatten(readLocale(SOURCE_LANG))
  const tgtBase = flatten(readLocaleAtRef(lang, baseRef) ?? {})
  const tgtNow = flatten(readLocale(lang))
  const pluralBases = findSourcePluralBases(enNow)
  const required = pluralCategoriesFor(lang)

  const items: StaleItem[] = []
  const handledPluralBases = new Set<string>()

  for (const [key, enNowVal] of enNow) {
    const enBaseVal = enBase.get(key)
    // Only care about *changed* English (skip newly added keys — those are `plan`'s job).
    if (enBaseVal === undefined || enBaseVal === enNowVal) continue

    const split = splitPlural(key)
    if (split && pluralBases.has(split.base)) {
      const base = split.base
      if (handledPluralBases.has(base)) continue
      handledPluralBases.add(base)
      const formsExistNow = required.some(cat => tgtNow.has(`${base}_${cat}`))
      const anyFormChanged = required.some(
        cat => tgtBase.get(`${base}_${cat}`) !== tgtNow.get(`${base}_${cat}`),
      )
      if (formsExistNow && !anyFormChanged) {
        const current: { [cat: string]: string } = {}
        for (const cat of required) {
          const v = tgtNow.get(`${base}_${cat}`)
          if (v !== undefined) current[cat] = v
        }
        items.push({
          key: base,
          type: 'plural',
          enOld: { one: enBase.get(`${base}_one`), other: enBase.get(`${base}_other`) },
          enNew: { one: enNow.get(`${base}_one`), other: enNow.get(`${base}_other`) },
          required,
          current,
        })
      }
    } else {
      const current = tgtNow.get(key)
      if (current !== undefined && tgtBase.get(key) === current) {
        items.push({ key, type: 'single', enOld: enBaseVal, enNew: enNowVal, current })
      }
    }
  }

  items.sort((a, b) => a.key.localeCompare(b.key))
  return items
}

function staleDetail(lang: string, baseRef: string, outFile?: string): void {
  const items = computeStale(lang, baseRef)
  console.log(`Stale check for "${lang}" (English changed since ${baseRef.slice(0, 12)}):`)
  if (!items.length) {
    console.log('  ✓ no stale translations')
    return
  }
  console.log(`  ${items.length} stale translation(s) — English changed but ${lang} did not:\n`)
  for (const item of items) {
    if (item.type === 'single') {
      console.log(`  - ${item.key}`)
      console.log(`      en:  "${item.enOld}" → "${item.enNew}"`)
      console.log(`      ${lang}: "${item.current}"  (unchanged — needs review)`)
    } else {
      console.log(`  - ${item.key} (plural)`)
      console.log(`      en (other): "${item.enOld.other ?? ''}" → "${item.enNew.other ?? ''}"`)
      console.log(`      ${lang}: ${JSON.stringify(item.current)}  (unchanged — needs review)`)
    }
  }
  if (outFile) {
    fs.writeFileSync(
      outFile,
      JSON.stringify({ lang, since: baseRef, items }, null, 2) + '\n',
      'utf8',
    )
    console.log(`\nWrote ${items.length} item(s) to ${outFile} (re-translate, then \`fix\`).`)
  }
  process.exitCode = 1
}

function staleSummary(baseRef: string): void {
  console.log(`Stale translations (English changed since ${baseRef.slice(0, 12)}):\n`)
  console.log('lang      stale')
  console.log('--------  -----')
  let total = 0
  for (const lang of TARGET_LANGUAGES) {
    const n = computeStale(lang, baseRef).length
    total += n
    console.log(`${lang.padEnd(8)}  ${n}`)
  }
  if (total) {
    console.log(
      `\n${total} stale translation(s). Run \`stale <lang> <outFile>\` for details + a work list.`,
    )
    process.exitCode = 1
  } else {
    console.log('\n✓ all languages up to date with the English source')
  }
}

function cmdStale(args: string[]): void {
  let since: string | undefined
  const positionals: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--since') {
      since = args[++i]
    } else {
      positionals.push(args[i])
    }
  }
  const baseRef = resolveBaseRef(since)
  const lang = positionals[0]
  if (lang) {
    assertTargetLang(lang)
    staleDetail(lang, baseRef, positionals[1])
  } else {
    staleSummary(baseRef)
  }
}

function assertTargetLang(lang: string): void {
  if (!(TARGET_LANGUAGES as readonly string[]).includes(lang)) {
    console.error(
      `"${lang}" is not a translation target. Valid targets: ${TARGET_LANGUAGES.join(', ')}`,
    )
    process.exit(1)
  }
}

// --- Entry point -------------------------------------------------------------

function main(): void {
  const [command, ...rest] = process.argv.slice(2)
  switch (command) {
    case 'status':
      cmdStatus()
      break
    case 'plan':
      cmdPlan(rest[0], rest[1])
      break
    case 'apply':
      if (!rest[1]) throw new Error('usage: apply <lang> <resultFile>')
      cmdApply(rest[0], rest[1])
      break
    case 'fix':
      if (!rest[1]) throw new Error('usage: fix <lang> <resultFile>')
      cmdFix(rest[0], rest[1])
      break
    case 'terms':
      cmdTerms(rest[0], rest[1])
      break
    case 'stale':
      cmdStale(rest)
      break
    case 'prune':
      cmdPrune(rest[0])
      break
    case 'normalize':
      cmdNormalize(rest[0])
      break
    case 'check':
      cmdCheck(rest[0])
      break
    default:
      console.error(
        'usage: i18n <status|plan|apply|fix|terms|stale|prune|normalize|check> [args]\n' +
          '  status                       overview of missing/orphan counts per language\n' +
          '  plan <lang> [outFile]        write the to-translate work list as JSON\n' +
          '  apply <lang> <resultFile>    validate + merge translations for MISSING keys\n' +
          '  fix <lang> <resultFile>      validate + overwrite EXISTING translations (quality/register fixes)\n' +
          '  terms <lang> <query>         look up Blizzard-matched glossary terms (source or target)\n' +
          '  stale [lang] [outFile]       find translations whose English source changed (use --since <ref>)\n' +
          '  prune <lang>                 delete orphan keys no longer present in `en`\n' +
          '  normalize <lang>             rewrite formatting (indent/sort) to match `en`, no content change\n' +
          '  check <lang>                 read-only audit (orphans, plurals, token drift, format)',
      )
      process.exit(1)
  }
}

main()
