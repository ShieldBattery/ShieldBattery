/**
 * Deterministic helper for agent-driven translation of our i18next locale files.
 *
 * This script owns all the *mechanical* work so an LLM never has to touch JSON structure:
 *   - finding keys present in `en` but missing in a target language (plural-aware)
 *   - finding orphan keys present in a target language but no longer in `en`
 *   - validating that translations preserve `{{interpolations}}` and `<0>` Trans tags
 *   - merging translated values back in, then re-sorting/re-formatting to match the
 *     output `i18next-cli` produces for `en` (2-space indent, LF, alphabetical sort)
 *
 * The agent's only job is to produce translation *values*; everything else is here so it's
 * reproducible and can't silently corrupt a file.
 *
 * Plural categories are resolved from `Intl.PluralRules` (the same CLDR data i18next uses at
 * runtime), so each language gets exactly the plural forms it needs — `es` => one/many/other,
 * `ru` => one/few/many/other, `ko`/`zh-Hans` => other only.
 *
 * Usage (run from repo root):
 *   pnpm run i18n status                       # overview of missing/orphan counts (both namespaces)
 *   pnpm run i18n show <key|prefix>... [--grep <regex>]  # en + every language side by side
 *   pnpm run i18n plan <lang|all> [outFile]    # write the to-translate work list (JSON)
 *   pnpm run i18n apply <lang|all> <resultFile>  # validate + merge translations for missing keys
 *   pnpm run i18n fix <lang|all> <resultFile>  # validate + overwrite existing translations (quality fixes)
 *   pnpm run i18n terms <lang> <query>         # look up Blizzard-matched glossary terms
 *   pnpm run i18n stale [lang|all] [outFile]   # find translations whose English source changed (--since <ref>)
 *   pnpm run i18n prune <lang|all>             # delete orphan keys no longer present in `en`
 *   pnpm run i18n normalize <lang|all>         # reformat (indent/sort) to match `en`, no content change
 *   pnpm run i18n check <lang|all>             # read-only audit (orphans, plurals, token drift)
 *   pnpm run i18n rename <oldPrefix> <newPrefix>  # move a key/subtree in every target language
 *
 * Languages come from common/i18n.ts (`en` is the source and is never a target). `all` stands for
 * every target language.
 */

import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import {
  ALL_TRANSLATION_LANGUAGES,
  ALL_TRANSLATION_NAMESPACES,
  TranslationLanguage,
  TranslationNamespace,
} from '../common/i18n'

const SOURCE_LANG = TranslationLanguage.English
const REPO_ROOT = path.resolve(__dirname, '..')
const LOCALES_DIR = path.join(REPO_ROOT, 'server', 'public', 'locales')
/**
 * The namespace (one JSON file per language) every command operates on. `global` is the app's;
 * `game` is the in-game UI's. Selected with `--ns <name>` on the command line.
 */
let namespace: string = TranslationNamespace.Global
/** Whether `--ns` was given, for commands that cover every namespace when it was not. */
let namespaceExplicit = false

/** The `<lang>` argument value that selects every target language. */
const ALL_LANGUAGES = 'all'

/** Blizzard-matched terminology glossaries (CSV per language), used by the `terms` command. */
const TERMS_DIR = path.join(REPO_ROOT, '.claude', 'skills', 'translate-i18n', 'terms')

const TARGET_LANGUAGES = ALL_TRANSLATION_LANGUAGES.filter(l => l !== SOURCE_LANG)

/** All possible CLDR cardinal plural suffixes, used to recognize plural keys. */
const ALL_PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const
type PluralCategory = (typeof ALL_PLURAL_CATEGORIES)[number]

type LocaleObject = { [key: string]: string | LocaleObject }

// --- File IO -----------------------------------------------------------------

function localePath(lang: string): string {
  return path.join(LOCALES_DIR, lang, `${namespace}.json`)
}

function readLocale(lang: string): LocaleObject {
  const file = localePath(lang)
  // A target language's file for a namespace doesn't exist until the first `apply` creates it;
  // the source language's file must exist, since everything is derived from it.
  if (!fs.existsSync(file)) {
    if (lang !== SOURCE_LANG) {
      return {}
    }
    console.error(
      `${path.relative(REPO_ROOT, file)} does not exist: the "${namespace}" namespace has no ` +
        `extracted strings yet (run \`pnpm gen-translations\` after adding some).`,
    )
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as LocaleObject
}

/**
 * Reproduces the extractor's default key sort (i18next-parser's `makeDefaultSort`, which
 * `i18next-cli` with `sort: true` matches byte for byte) so our
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

export function compareKeys(a: string, b: string): number {
  const singularA = getSingularForm(a)
  const singularB = getSingularForm(b)
  if (singularA === singularB) {
    return getPluralSuffixPosition(a) - getPluralSuffixPosition(b)
  }
  return singularA.localeCompare(singularB, 'en')
}

/**
 * Recursively sorts object keys (matching i18next-cli) and serializes with 2-space indent + a
 * trailing newline. This reproduces what `i18next-cli` (sort: true) writes for
 * `en`, so applying changes never reformats the whole file.
 */
export function serializeLocale(obj: LocaleObject): string {
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

export function flatten(
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

export function setDeep(obj: LocaleObject, dottedKey: string, value: string): void {
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

export function deleteDeep(obj: LocaleObject, dottedKey: string): void {
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

export function pluralCategoriesFor(lang: string): PluralCategory[] {
  const cats = new Intl.PluralRules(lang, { type: 'cardinal' }).resolvedOptions().pluralCategories
  // Keep our canonical ordering for stable output.
  return ALL_PLURAL_CATEGORIES.filter(c => cats.includes(c))
}

/** Splits a flat key into `{ base, category }` if it ends in a plural suffix, else null. */
export function splitPlural(key: string): { base: string; category: PluralCategory } | null {
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
export function findSourcePluralBases(enFlat: Map<string, string>): Set<string> {
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
export function extractTokens(value: string): string[] {
  const tokens = value.match(/\{\{[^}]+\}\}|<\/?[^>]+>/g) ?? []
  return tokens.slice().sort()
}

export function tokensEqual(a: string, b: string): boolean {
  const ta = extractTokens(a)
  const tb = extractTokens(b)
  return ta.length === tb.length && ta.every((t, i) => t === tb[i])
}

/**
 * The English source form to token-validate a target plural category against. English has only `one`
 * and `other`, so the `one` category maps to `en.one` and every other category (few/many/other/zero/
 * two) maps to `en.other` — falling back to whichever form exists. This matters when `en.one` and
 * `en.other` carry different tokens (e.g. `one: "a member"` vs `other: "{{count}} members"`).
 */
export function enReferenceForCategory(
  cat: PluralCategory,
  enOne: string | undefined,
  enOther: string | undefined,
): string {
  return cat === 'one' ? (enOne ?? enOther ?? '') : (enOther ?? enOne ?? '')
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
  return buildPlan(flatten(readLocale(SOURCE_LANG)), flatten(readLocale(lang)), lang)
}

/** Pure core of `computePlan`: the missing-key diff over already-flattened locale maps. */
export function buildPlan(
  enFlat: Map<string, string>,
  targetFlat: Map<string, string>,
  lang: string,
): Plan {
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
  return buildOrphans(flatten(readLocale(SOURCE_LANG)), flatten(readLocale(lang)), lang)
}

/** Pure core of `computeOrphans` over already-flattened locale maps. */
export function buildOrphans(
  enFlat: Map<string, string>,
  targetFlat: Map<string, string>,
  lang: string,
): string[] {
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

/** Expands a `<lang>` argument (a target language, or `all`) into the languages it selects. */
function resolveLangs(lang: string | undefined): string[] {
  if (lang === ALL_LANGUAGES) return [...TARGET_LANGUAGES]
  assertTargetLang(lang)
  return [lang]
}

function cmdStatus(): void {
  const original = namespace
  const namespaces = namespaceExplicit ? [namespace] : [...ALL_TRANSLATION_NAMESPACES]
  namespaces.forEach((ns, i) => {
    namespace = ns
    if (i > 0) console.log()
    if (!namespaceExplicit && !fs.existsSync(localePath(SOURCE_LANG))) {
      console.log(`[${ns}] no ${SOURCE_LANG} file (no extracted strings yet)`)
      return
    }
    const enFlat = flatten(readLocale(SOURCE_LANG))
    console.log(`[${ns}] Source (${SOURCE_LANG}): ${enFlat.size} keys\n`)
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
  })
  namespace = original
}

// --- Show --------------------------------------------------------------------

/** The most keys `show` prints before pointing the reader at a narrower prefix. */
const SHOW_KEY_LIMIT = 60

type ShowValue = string | { [cat: string]: string }

export interface ShowEntry {
  /** The key, or the plural base for a plural group. */
  key: string
  plural: boolean
  /** Each language's value; languages without the key are absent. */
  values: Map<string, ShowValue>
}

/**
 * Groups the keys of every language into logical entries (a plural group is one entry) and selects
 * those under any of `prefixes` (an exact key or a dotted subtree) whose text in some language
 * matches `grep`. With no prefixes every entry is a candidate; with no `grep` every candidate is
 * kept. Entries follow the source file's order, with keys only a target has last. `unmatched`
 * lists the prefixes that selected nothing.
 */
export function collectShowEntries(
  locales: Map<string, Map<string, string>>,
  prefixes: string[],
  grep: RegExp | undefined,
): { entries: ShowEntry[]; unmatched: string[] } {
  const pluralBases = findSourcePluralBases(locales.get(SOURCE_LANG) ?? new Map())
  const groups = new Map<string, Set<string>>()
  for (const flat of locales.values()) {
    for (const key of flat.keys()) {
      const split = splitPlural(key)
      const group = split && pluralBases.has(split.base) ? split.base : key
      const members = groups.get(group) ?? new Set<string>()
      members.add(key)
      groups.set(group, members)
    }
  }

  const wanted = prefixes.map(p => p.replace(/\.+$/, ''))
  const unmatched = new Set(wanted)
  const entries: ShowEntry[] = []
  for (const [key, members] of groups) {
    let selected = wanted.length === 0
    for (const p of wanted) {
      if (key === p || key.startsWith(`${p}.`) || members.has(p)) {
        selected = true
        unmatched.delete(p)
      }
    }
    if (!selected) continue

    const plural = pluralBases.has(key)
    const values = new Map<string, ShowValue>()
    for (const [lang, flat] of locales) {
      if (plural) {
        const forms: { [cat: string]: string } = {}
        for (const cat of ALL_PLURAL_CATEGORIES) {
          const form = flat.get(`${key}_${cat}`)
          if (form !== undefined) forms[cat] = form
        }
        if (Object.keys(forms).length) values.set(lang, forms)
      } else {
        const value = flat.get(key)
        if (value !== undefined) values.set(lang, value)
      }
    }
    if (grep) {
      const texts = [...values.values()].flatMap(v =>
        typeof v === 'string' ? [v] : Object.values(v),
      )
      if (!texts.some(t => grep.test(t))) continue
    }
    entries.push({ key, plural, values })
  }
  return { entries, unmatched: [...unmatched] }
}

function formatShowValue(value: ShowValue | undefined): string {
  if (value === undefined) return '(missing)'
  const text =
    typeof value === 'string'
      ? value
      : ALL_PLURAL_CATEGORIES.filter(cat => cat in value)
          .map(cat => `${cat}=${value[cat]}`)
          .join(' | ')
  return text.replace(/\n/g, '\\n')
}

function cmdShow(args: string[]): void {
  const { value: grepSource, rest: prefixes } = takeValueOption(args, '--grep')
  if (!prefixes.length && grepSource === undefined) {
    console.error('usage: show <keyOrPrefix>... [--grep <regex>]')
    process.exit(1)
  }
  let grep: RegExp | undefined
  if (grepSource !== undefined) {
    try {
      grep = new RegExp(grepSource, 'i')
    } catch (err) {
      console.error(`--grep is not a valid regex: ${(err as Error).message}`)
      process.exit(1)
    }
  }

  const locales = new Map<string, Map<string, string>>()
  for (const lang of [SOURCE_LANG, ...TARGET_LANGUAGES]) {
    locales.set(lang, flatten(readLocale(lang)))
  }
  const { entries, unmatched } = collectShowEntries(locales, prefixes, grep)
  for (const p of unmatched) console.log(`(no key matches "${p}")`)
  if (!entries.length) {
    if (!unmatched.length) console.log('(no matching keys)')
    process.exitCode = 1
    return
  }
  for (const entry of entries.slice(0, SHOW_KEY_LIMIT)) {
    console.log(`${entry.key}${entry.plural ? ' (plural)' : ''}`)
    for (const lang of locales.keys()) {
      console.log(`  ${lang.padEnd(7)} ${formatShowValue(entry.values.get(lang))}`)
    }
  }
  if (entries.length > SHOW_KEY_LIMIT) {
    console.log(`… ${entries.length - SHOW_KEY_LIMIT} more keys, narrow the prefix`)
  }
}

// --- Plan --------------------------------------------------------------------

/** One entry of a combined work list: a key and every language still missing it. */
interface AllPlanItem {
  key: string
  type: 'single' | 'plural'
  en: string | { one?: string; other?: string }
  missing: string[]
  /** For plural items, the forms each missing language needs. */
  required?: { [lang: string]: PluralCategory[] }
}

interface AllPlan {
  languages: string[]
  items: AllPlanItem[]
}

/** Merges per-language plans into one work list with a row per key. */
export function mergePlans(plans: Plan[]): AllPlan {
  const byKey = new Map<string, AllPlanItem>()
  for (const plan of plans) {
    for (const item of plan.items) {
      let merged = byKey.get(item.key)
      if (!merged) {
        merged = { key: item.key, type: item.type, en: item.en, missing: [] }
        if (item.type === 'plural') merged.required = {}
        byKey.set(item.key, merged)
      }
      merged.missing.push(plan.lang)
      if (item.type === 'plural' && merged.required) merged.required[plan.lang] = item.required
    }
  }
  return {
    languages: plans.map(p => p.lang),
    items: [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)),
  }
}

function cmdPlan(langArg: string | undefined, outFile?: string): void {
  const langs = resolveLangs(langArg)
  const plan =
    langArg === ALL_LANGUAGES ? mergePlans(langs.map(computePlan)) : computePlan(langs[0])
  const json = JSON.stringify(plan, null, 2)
  if (outFile) {
    fs.writeFileSync(outFile, json + '\n', 'utf8')
    console.log(`Wrote ${plan.items.length} work item(s) for "${langArg}" to ${outFile}`)
  } else {
    console.log(json)
  }
}

// --- Apply / fix -------------------------------------------------------------

/** A key's translation: a string, or an object of plural forms. */
type TranslationValue = string | { [cat: string]: string }
type Translations = { [key: string]: TranslationValue }

interface ResultFile {
  translations: { [key: string]: unknown }
}

/** A validated batch of values ready to merge into one language's file. */
interface PendingWrite {
  lang: string
  errors: string[]
  values: Array<{ key: string; value: string }>
  /** Lines to print once the values are written. */
  report: string[]
}

function mismatchMessage(label: string, reference: string, value: string): string {
  return `${label}: interpolation/tag mismatch — en has [${extractTokens(reference).join(', ')}], translation has [${extractTokens(value).join(', ')}]`
}

/**
 * Validates a plural object against the forms `required` for the language (each token-checked
 * against the English form it derives from), returning the flat values to write. Problems are
 * appended to `errors`.
 */
function checkPluralValue(
  key: string,
  value: unknown,
  required: PluralCategory[],
  enOne: string | undefined,
  enOther: string | undefined,
  errors: string[],
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = []
  if (typeof value !== 'object' || value === null) {
    errors.push(`"${key}": plural key expects an object of { ${required.join(', ')} }`)
    return out
  }
  for (const cat of required) {
    const form = (value as Record<string, unknown>)[cat]
    if (typeof form !== 'string') {
      errors.push(`"${key}": missing required plural form "${cat}"`)
      continue
    }
    const reference = enReferenceForCategory(cat, enOne, enOther)
    if (!tokensEqual(reference, form)) {
      errors.push(mismatchMessage(`"${key}" (${cat})`, reference, form))
      continue
    }
    out.push({ key: `${key}_${cat}`, value: form })
  }
  const extra = Object.keys(value).filter(c => !required.includes(c as PluralCategory))
  if (extra.length) {
    errors.push(
      `"${key}": unexpected plural form(s) [${extra.join(', ')}] (language uses ${required.join('/')})`,
    )
  }
  return out
}

/** Validates translations for the keys still missing from `lang` (those in its plan). */
function prepareApply(lang: string, translations: Translations): PendingWrite {
  const plan = computePlan(lang)
  const planByKey = new Map(plan.items.map(item => [item.key, item]))
  const pending: PendingWrite = { lang, errors: [], values: [], report: [] }

  for (const [key, value] of Object.entries(translations)) {
    const item = planByKey.get(key)
    if (!item) {
      pending.errors.push(
        `"${key}": not in the to-translate plan (already translated or unknown key)`,
      )
    } else if (item.type === 'single') {
      if (typeof value !== 'string') {
        pending.errors.push(`"${key}": expected a string value`)
      } else if (!tokensEqual(item.en, value)) {
        pending.errors.push(mismatchMessage(`"${key}"`, item.en, value))
      } else {
        pending.values.push({ key, value })
      }
    } else {
      pending.values.push(
        ...checkPluralValue(key, value, item.required, item.en.one, item.en.other, pending.errors),
      )
    }
  }

  const remaining = plan.items.filter(item => !(item.key in translations)).length
  pending.report.push(
    `Applied ${pending.values.length} value(s) to "${lang}". ${remaining} work item(s) still remaining.`,
  )
  return pending
}

/** Validates replacements for translations `lang` already has, reporting each before→after. */
function prepareFix(lang: string, translations: Translations): PendingWrite {
  const enFlat = flatten(readLocale(SOURCE_LANG))
  const targetFlat = flatten(readLocale(lang))
  const pluralBases = findSourcePluralBases(enFlat)
  const required = pluralCategoriesFor(lang)
  const pending: PendingWrite = { lang, errors: [], values: [], report: [] }

  for (const [key, value] of Object.entries(translations)) {
    if (typeof value === 'string') {
      if (!targetFlat.has(key)) {
        pending.errors.push(`"${key}": not present in "${lang}" (use \`apply\` to add new keys)`)
        continue
      }
      const en = enFlat.get(key)
      if (en !== undefined && !tokensEqual(en, value)) {
        pending.errors.push(mismatchMessage(`"${key}"`, en, value))
        continue
      }
      pending.values.push({ key, value })
    } else if (typeof value === 'object' && value !== null) {
      if (!pluralBases.has(key)) {
        pending.errors.push(
          `"${key}": not a plural base in \`en\` (pass a plural object only for plurals)`,
        )
        continue
      }
      pending.values.push(
        ...checkPluralValue(
          key,
          value,
          required,
          enFlat.get(`${key}_one`),
          enFlat.get(`${key}_other`),
          pending.errors,
        ),
      )
    } else {
      pending.errors.push(`"${key}": expected a string or plural object`)
    }
  }

  pending.report.push(`Fixed ${pending.values.length} value(s) in "${lang}":`)
  for (const { key, value } of pending.values) {
    const from = targetFlat.get(key)
    pending.report.push(
      from === value ? `  = ${key}: (unchanged)` : `  - ${key}: "${from ?? ''}" → "${value}"`,
    )
  }
  return pending
}

/**
 * Splits an all-languages result (`{ key: { lang: value } }`) into one translations map per
 * language, reporting entries that are not keyed by a known target language.
 */
export function splitByLanguage(
  translations: { [key: string]: unknown },
  languages: readonly string[],
): { byLang: Map<string, Translations>; errors: string[] } {
  const byLang = new Map<string, Translations>(languages.map(lang => [lang, {}]))
  const errors: string[] = []
  for (const [key, perLang] of Object.entries(translations)) {
    if (typeof perLang !== 'object' || perLang === null || Array.isArray(perLang)) {
      errors.push(`"${key}": expected an object keyed by language (${languages.join(', ')})`)
      continue
    }
    for (const [lang, value] of Object.entries(perLang)) {
      const bucket = byLang.get(lang)
      if (!bucket) {
        errors.push(`"${key}": unknown language "${lang}" (valid: ${languages.join(', ')})`)
        continue
      }
      bucket[key] = value as TranslationValue
    }
  }
  return { byLang, errors }
}

function mergeValues(lang: string, values: Array<{ key: string; value: string }>): void {
  const target = readLocale(lang)
  for (const { key, value } of values) setDeep(target, key, value)
  writeLocale(lang, target)
}

/**
 * Shared driver for `apply` and `fix`: validates every language's entries first and writes nothing
 * unless all of them pass. In all-languages mode it finishes with the `check` verdict per language.
 */
function cmdWrite(kind: 'apply' | 'fix', langArg: string | undefined, resultFile: string): void {
  const langs = resolveLangs(langArg)
  const isAll = langArg === ALL_LANGUAGES
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as ResultFile
  const raw = result.translations ?? {}

  const errors: string[] = []
  let byLang: Map<string, Translations>
  if (isAll) {
    const split = splitByLanguage(raw, langs)
    errors.push(...split.errors)
    byLang = split.byLang
  } else {
    byLang = new Map([[langs[0], raw as Translations]])
  }

  const prepare = kind === 'apply' ? prepareApply : prepareFix
  const pendings: PendingWrite[] = []
  for (const [lang, translations] of byLang) {
    if (isAll && !Object.keys(translations).length) continue
    const pending = prepare(lang, translations)
    errors.push(...pending.errors.map(e => (isAll ? `[${lang}] ${e}` : e)))
    pendings.push(pending)
  }

  if (errors.length) {
    console.error(`Validation failed — nothing written. ${errors.length} error(s):`)
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }

  for (const pending of pendings) {
    mergeValues(pending.lang, pending.values)
    for (const line of pending.report) console.log(line)
  }
  if (isAll) {
    for (const lang of langs) {
      console.log()
      checkLang(lang)
    }
  }
}

// --- Prune / normalize / check -----------------------------------------------

function cmdPrune(langArg: string | undefined): void {
  for (const lang of resolveLangs(langArg)) {
    const orphans = computeOrphans(lang)
    if (!orphans.length) {
      console.log(`No orphan keys in "${lang}".`)
      continue
    }
    const target = readLocale(lang)
    for (const key of orphans) deleteDeep(target, key)
    writeLocale(lang, target)
    console.log(`Deleted ${orphans.length} orphan key(s) from "${lang}":`)
    for (const key of orphans) console.log(`  - ${key}`)
  }
}

function cmdNormalize(langArg: string | undefined): void {
  for (const lang of resolveLangs(langArg)) {
    if (!fs.existsSync(localePath(lang))) {
      console.log(`"${lang}" has no ${namespace} file.`)
      continue
    }
    const before = fs.readFileSync(localePath(lang), 'utf8')
    const after = serializeLocale(readLocale(lang))
    if (before === after) {
      console.log(`"${lang}" already normalized.`)
      continue
    }
    fs.writeFileSync(localePath(lang), after, 'utf8')
    console.log(
      `Normalized "${lang}" formatting (indent/sort) to match the parser output for \`en\`.`,
    )
  }
}

/** Prints the read-only audit for one language and returns whether it is clean. */
function checkLang(lang: string): boolean {
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
  const file = localePath(lang)
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : serializeLocale({})
  const formatOk = current === serializeLocale(readLocale(lang))

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
  return clean
}

function cmdCheck(langArg: string | undefined): void {
  const langs = resolveLangs(langArg)
  let allClean = true
  langs.forEach((lang, i) => {
    if (i > 0) console.log()
    if (!checkLang(lang)) allClean = false
  })
  if (!allClean) process.exitCode = 1
}

// --- Rename ------------------------------------------------------------------

/**
 * Plans moving the key `from` (with its plural forms) or the subtree under it to `to` within one
 * language's flat keys. `conflicts` lists destination keys that collide with a key that is not
 * itself being moved, including a leaf sitting where a subtree would go (and vice versa).
 */
export function planRename(
  flat: Map<string, string>,
  from: string,
  to: string,
): { moves: Array<[string, string]>; conflicts: string[] } {
  const moves: Array<[string, string]> = []
  for (const key of flat.keys()) {
    const isMoved = key === from || key.startsWith(`${from}.`) || splitPlural(key)?.base === from
    if (isMoved) moves.push([key, to + key.slice(from.length)])
  }

  const moving = new Set(moves.map(([source]) => source))
  const staying = [...flat.keys()].filter(key => !moving.has(key))
  const stayingSet = new Set(staying)
  const conflicts: string[] = []
  for (const [, dest] of moves) {
    const parts = dest.split('.')
    const leafInTheWay = parts.some((_, i) => stayingSet.has(parts.slice(0, i + 1).join('.')))
    const subtreeInTheWay = staying.some(key => key.startsWith(`${dest}.`))
    if (leafInTheWay || subtreeInTheWay) conflicts.push(dest)
  }
  return { moves, conflicts }
}

function cmdRename(from: string | undefined, to: string | undefined): void {
  if (!from || !to) {
    console.error('usage: rename <oldPrefix> <newPrefix>')
    process.exit(1)
  }
  const trim = (p: string) => p.replace(/\.+$/, '')
  const [oldPrefix, newPrefix] = [trim(from), trim(to)]
  if (!oldPrefix || !newPrefix || oldPrefix === newPrefix) {
    console.error('rename needs two different, non-empty key paths.')
    process.exit(1)
  }

  const plans = TARGET_LANGUAGES.map(lang => {
    const locale = readLocale(lang)
    return { lang, locale, ...planRename(flatten(locale), oldPrefix, newPrefix) }
  })
  const conflicts = plans.flatMap(p => p.conflicts.map(dest => `[${p.lang}] ${dest}`))
  if (conflicts.length) {
    console.error(`Destination already exists — nothing written. ${conflicts.length} conflict(s):`)
    for (const c of conflicts) console.error(`  - ${c}`)
    process.exit(1)
  }
  if (plans.every(p => !p.moves.length)) {
    console.error(`No key in any target language is "${oldPrefix}" or under it.`)
    process.exit(1)
  }

  const flatByLang = new Map(plans.map(p => [p.lang, flatten(p.locale)]))
  for (const { lang, locale, moves } of plans) {
    if (!moves.length) {
      console.log(`${lang}: nothing under "${oldPrefix}"`)
      continue
    }
    const flat = flatByLang.get(lang)!
    for (const [source] of moves) deleteDeep(locale, source)
    for (const [source, dest] of moves) setDeep(locale, dest, flat.get(source)!)
    writeLocale(lang, locale)
    console.log(`${lang}: moved ${moves.length} key(s) to "${newPrefix}"`)
  }
}

// --- CSV terms lookup --------------------------------------------------------

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped `""`, embedded commas/newlines. */
export function parseCsv(text: string): string[][] {
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

/** Candidate names for the main branch, most authoritative first. */
const MAIN_REFS = ['origin/master', 'master', 'origin/main', 'main']

function git(gitArgs: string[], cwd: string): string {
  return execFileSync('git', gitArgs, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

/** Whether a git command exits successfully; git's own error output is never shown. */
function gitSucceeds(gitArgs: string[], cwd: string): boolean {
  try {
    execFileSync('git', gitArgs, { cwd, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function refExists(ref: string, cwd: string): boolean {
  return gitSucceeds(['rev-parse', '--verify', '--quiet', ref], cwd)
}

function localeRelPath(lang: string): string {
  return `${LOCALES_REL}/${lang}/${namespace}.json`
}

/** Whether the current namespace's locale file for `lang` existed at `ref`. */
export function localeExistsAtRef(lang: string, ref: string, cwd = REPO_ROOT): boolean {
  return gitSucceeds(['cat-file', '-e', `${ref}:${localeRelPath(lang)}`], cwd)
}

interface StaleBase {
  ref: string
  /** Why this ref was chosen, for display. */
  reason: string
}

/**
 * The ref `lang`'s translations are compared against. `--since` is used verbatim. Otherwise it is
 * the merge-base with the main branch, unless the last commit that touched the language's locale
 * file is an ancestor of that merge-base (older than it): translations are then judged against
 * English changes made since the file was last updated, which keeps the default useful on the main
 * branch itself, where the merge-base is HEAD.
 */
export function resolveStaleBase(
  lang: string,
  since: string | undefined,
  cwd = REPO_ROOT,
): StaleBase {
  if (since) {
    if (!refExists(since, cwd)) {
      console.error(`--since ref "${since}" doesn't resolve to a commit.`)
      process.exit(1)
    }
    return { ref: since, reason: '--since' }
  }
  const mainRef = MAIN_REFS.find(ref => refExists(ref, cwd))
  if (!mainRef) {
    console.error(
      'Could not find a main branch ref (origin/master, master, …). Pass --since <ref>.',
    )
    process.exit(1)
  }
  let mergeBase = mainRef
  try {
    mergeBase = git(['merge-base', 'HEAD', mainRef], cwd)
  } catch {
    // Unrelated histories: compare against the main ref itself.
  }
  let lastTouch = ''
  try {
    lastTouch = git(['log', '-1', '--format=%H', '--', localeRelPath(lang)], cwd)
  } catch {
    // No history for the file: fall back to the merge-base.
  }
  if (lastTouch && gitSucceeds(['merge-base', '--is-ancestor', lastTouch, mergeBase], cwd)) {
    return { ref: lastTouch, reason: `last ${lang} change` }
  }
  return { ref: mergeBase, reason: 'merge-base' }
}

/** A commit hash abbreviated for display; other refs (tags, branches) are shown as given. */
function shortRef(ref: string): string {
  return /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 12) : ref
}

function describeBase(base: StaleBase): string {
  return `${shortRef(base.ref)}, ${base.reason}`
}

/** Reads a locale file as it existed at `ref`, or null if it didn't exist there. */
function readLocaleAtRef(lang: string, ref: string): LocaleObject | null {
  try {
    const content = execFileSync('git', ['show', `${ref}:${localeRelPath(lang)}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
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
  return findStale(
    flatten(readLocaleAtRef(SOURCE_LANG, baseRef) ?? {}),
    flatten(readLocale(SOURCE_LANG)),
    flatten(readLocaleAtRef(lang, baseRef) ?? {}),
    flatten(readLocale(lang)),
    lang,
  )
}

/** Pure core of `computeStale`: the changed-English-but-unchanged-translation diff over flat maps. */
export function findStale(
  enBase: Map<string, string>,
  enNow: Map<string, string>,
  tgtBase: Map<string, string>,
  tgtNow: Map<string, string>,
  lang: string,
): StaleItem[] {
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

function staleDetail(lang: string, since: string | undefined, outFile?: string): void {
  const base = resolveStaleBase(lang, since)
  if (!localeExistsAtRef(SOURCE_LANG, base.ref)) {
    console.log(
      `Stale check for "${lang}": ${SOURCE_LANG}/${namespace}.json did not exist at ${describeBase(base)}; nothing can be stale.`,
    )
    return
  }
  const items = computeStale(lang, base.ref)
  console.log(`Stale check for "${lang}" (English changed since ${describeBase(base)}):`)
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
      JSON.stringify({ lang, since: base.ref, items }, null, 2) + '\n',
      'utf8',
    )
    console.log(`\nWrote ${items.length} item(s) to ${outFile} (re-translate, then \`fix\`).`)
  }
  process.exitCode = 1
}

function staleSummary(since: string | undefined): void {
  console.log(`Stale translations [${namespace}] (English changed since each language's base):\n`)
  console.log('lang      stale  base')
  console.log('--------  -----  ----')
  let total = 0
  let compared = 0
  for (const lang of TARGET_LANGUAGES) {
    const base = resolveStaleBase(lang, since)
    if (!localeExistsAtRef(SOURCE_LANG, base.ref)) {
      console.log(
        `${lang.padEnd(8)}  -      ${describeBase(base)}; ${SOURCE_LANG}/${namespace}.json did not exist there`,
      )
      continue
    }
    compared++
    const n = computeStale(lang, base.ref).length
    total += n
    console.log(`${lang.padEnd(8)}  ${String(n).padEnd(5)}  ${describeBase(base)}`)
  }
  if (total) {
    console.log(
      `\n${total} stale translation(s). Run \`stale <lang> <outFile>\` for details + a work list.`,
    )
    process.exitCode = 1
  } else if (compared) {
    console.log('\n✓ all compared languages up to date with the English source')
  } else {
    console.log('\nNothing to compare: no base ref has the English file.')
  }
}

function cmdStale(args: string[]): void {
  const { value: since, rest: positionals } = takeValueOption(args, '--since')
  const lang = positionals[0]
  if (lang && lang !== ALL_LANGUAGES) {
    assertTargetLang(lang)
    staleDetail(lang, since, positionals[1])
  } else {
    staleSummary(since)
  }
}

function assertTargetLang(lang: string | undefined): asserts lang is string {
  if (!lang || !(TARGET_LANGUAGES as readonly string[]).includes(lang)) {
    console.error(
      `"${lang ?? ''}" is not a translation target. Valid targets: ${TARGET_LANGUAGES.join(', ')}, or "${ALL_LANGUAGES}"`,
    )
    process.exit(1)
  }
}

/**
 * Pulls `<name> <value>` (or `<name>=<value>`) out of the arguments, wherever it appears, and
 * returns the value with the remaining arguments.
 */
function takeValueOption(
  args: string[],
  name: string,
): { value: string | undefined; rest: string[] } {
  const rest: string[] = []
  let value: string | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === name) {
      value = args[++i]
      if (value === undefined) {
        console.error(`${name} needs a value`)
        process.exit(1)
      }
    } else if (arg.startsWith(`${name}=`)) {
      value = arg.slice(name.length + 1)
    } else {
      rest.push(arg)
    }
  }
  return { value, rest }
}

// --- Entry point -------------------------------------------------------------

/**
 * Pulls a `--ns <name>` / `--ns=<name>` option out of the arguments (wherever it appears) and
 * returns the remaining arguments.
 */
function takeNamespaceOption(args: string[]): string[] {
  const { value, rest } = takeValueOption(args, '--ns')
  if (value !== undefined) {
    if (!(ALL_TRANSLATION_NAMESPACES as readonly string[]).includes(value)) {
      console.error(
        `--ns needs one of: ${ALL_TRANSLATION_NAMESPACES.join(', ')} (got ${JSON.stringify(value)})`,
      )
      process.exit(1)
    }
    namespace = value
    namespaceExplicit = true
  }
  return rest
}

function main(): void {
  const [command, ...rest] = takeNamespaceOption(process.argv.slice(2))
  switch (command) {
    case 'status':
      cmdStatus()
      break
    case 'show':
      cmdShow(rest)
      break
    case 'plan':
      cmdPlan(rest[0], rest[1])
      break
    case 'apply':
      if (!rest[1]) throw new Error('usage: apply <lang|all> <resultFile>')
      cmdWrite('apply', rest[0], rest[1])
      break
    case 'fix':
      if (!rest[1]) throw new Error('usage: fix <lang|all> <resultFile>')
      cmdWrite('fix', rest[0], rest[1])
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
    case 'rename':
      cmdRename(rest[0], rest[1])
      break
    default:
      console.error(
        'usage: i18n [--ns <global|game>] <status|show|plan|apply|fix|terms|stale|prune|normalize|check|rename> [args]\n' +
          '  <lang> is es|ko|ru|zh-Hans, or `all` where shown\n' +
          '  --ns <name>                  namespace file to work on (default: global; game = in-game UI;\n' +
          '                               `status` covers both unless given)\n' +
          '  status                       overview of missing/orphan counts per language\n' +
          '  show <key|prefix>... [--grep <regex>]  en + every language side by side\n' +
          '  plan <lang|all> [outFile]    write the to-translate work list as JSON\n' +
          '  apply <lang|all> <resultFile>  validate + merge translations for MISSING keys\n' +
          '  fix <lang|all> <resultFile>  validate + overwrite EXISTING translations (quality/register fixes)\n' +
          '  terms <lang> <query>         look up Blizzard-matched glossary terms (source or target)\n' +
          '  stale [lang|all] [outFile]   find translations whose English source changed (use --since <ref>)\n' +
          '  prune <lang|all>             delete orphan keys no longer present in `en`\n' +
          '  normalize <lang|all>         rewrite formatting (indent/sort) to match `en`, no content change\n' +
          '  check <lang|all>             read-only audit (orphans, plurals, token drift, format)\n' +
          '  rename <oldPrefix> <newPrefix>  move a key or subtree in every target language (not `en`)',
      )
      process.exit(1)
  }
}

// Only run the CLI when invoked directly (e.g. via `pnpm run i18n`), not when imported by tests.
if (typeof require !== 'undefined' && require.main === module) {
  main()
}
