import MagicString from 'magic-string'
import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import type { ESTree } from 'rolldown/utils'
import { parseSync } from 'rolldown/utils'
import type { Plugin } from 'vite'

/** Directory graphql-codegen's client preset writes into. */
const GQL_DIR = 'client/gql'
/** Generated module holding the string-to-document map that `graphql()` looks up at runtime. */
const DOCUMENTS_MODULE = `${GQL_DIR}/gql.ts`
/** Generated module holding the document nodes themselves, which is what we import from. */
const DOCUMENT_NODES_MODULE = `${GQL_DIR}/graphql`

/**
 * Rewrites `graphql('query Foo { … }')` calls into direct imports of the document node
 * graphql-codegen already generated for them.
 *
 * Without this, every call site keeps its query as a string and reaches into the `documents` map
 * in `client/gql/gql.ts` at runtime, so each query ships twice: once inline at the call site and
 * once as a key of that map. Rewriting the calls removes the last reference to the map and drops
 * both copies.
 *
 * It does not defer the document nodes themselves. Codegen emits all of them as a single
 * `client/gql/graphql.ts`, and a module lands in exactly one chunk, so every document still
 * loads up front no matter which routes reference it. Splitting that would be a codegen output
 * question, not a bundler one.
 *
 * The mapping comes from the generated `documents` map rather than from re-deriving export names
 * out of the GraphQL source. Its keys are the exact strings the call sites pass (that is how the
 * runtime lookup works at all), so a hit is correct by construction and cannot drift from
 * codegen's naming configuration. A miss simply leaves the call alone, falling back to the
 * runtime lookup, which stays correct — just unoptimized.
 *
 * Build-only. The optimization is purely about production bundle size, and skipping it in dev
 * avoids having to invalidate every call site whenever codegen rewrites the map.
 */
export function graphqlOptimizer(root: string): Plugin {
  /** Query string -> the name it is exported under by {@link DOCUMENT_NODES_MODULE}. */
  let documents = new Map<string, string>()
  const gqlDir = resolve(root, GQL_DIR)

  return {
    name: 'sb:graphql-optimizer',
    apply: 'build',

    async buildStart() {
      const path = resolve(root, DOCUMENTS_MODULE)
      documents = parseDocumentsMap(await readFile(path, 'utf8'), path)
      if (!documents.size) {
        this.warn(
          `No documents found in ${DOCUMENTS_MODULE}; graphql() calls will fall back to the ` +
            `runtime lookup. Has the generated file's shape changed?`,
        )
      }
      this.addWatchFile(path)
    },

    transform: {
      filter: { id: /\.[jt]sx?$/, code: { include: 'graphql(' } },

      async handler(code, id) {
        const program = this.parse(code, { lang: langFor(id) })

        // Only rewrite calls to a `graphql` that actually came from the generated module. Note
        // that every call site imports it through the barrel (`client/gql/index.ts`), so match on
        // where the source resolves to rather than on the specifier text.
        const tagNames = new Set<string>()
        for (const statement of program.body) {
          if (statement.type !== 'ImportDeclaration') continue
          const specifiers = statement.specifiers.filter(
            s => s.type === 'ImportSpecifier' && importedName(s) === 'graphql',
          )
          if (!specifiers.length) continue

          const resolved = await this.resolve(statement.source.value as string, id)
          if (!resolved || !isInside(gqlDir, resolved.id)) continue
          for (const specifier of specifiers) tagNames.add(specifier.local.name)
        }
        if (!tagNames.size) return null

        const edits: Array<{ start: number; end: number; name: string }> = []
        walk(program, node => {
          if (node.type !== 'CallExpression') return
          const call = node as ESTree.CallExpression
          if (call.callee.type !== 'Identifier' || !tagNames.has(call.callee.name)) return

          const [argument] = call.arguments
          // Interpolated templates aren't statically known, and codegen can't have generated a
          // document for one either.
          if (argument?.type !== 'TemplateLiteral' || argument.expressions.length) return

          const [quasi] = argument.quasis
          const name = documents.get(quasi.value.cooked ?? quasi.value.raw)
          if (name) edits.push({ start: call.start, end: call.end, name })
        })
        if (!edits.length) return null

        const s = new MagicString(code)
        for (const edit of edits) s.overwrite(edit.start, edit.end, edit.name)
        const names = [...new Set(edits.map(e => e.name))].sort()
        s.prepend(`import { ${names.join(', ')} } from '${importPathFor(id, root)}'\n`)

        return { code: s.toString(), map: s.generateMap({ hires: 'boundary' }) }
      },
    },
  }
}

/**
 * Pulls the `const documents = { '<query>': types.SomeDocument, … }` map out of the generated
 * source. Everything else in that file is types, which erase.
 */
function parseDocumentsMap(source: string, path: string): Map<string, string> {
  const result = new Map<string, string>()
  const program = parseSync(path, source, { lang: 'ts' }).program as ESTree.Program

  for (const statement of program.body) {
    if (statement.type !== 'VariableDeclaration') continue
    for (const declarator of statement.declarations) {
      if (declarator.id.type !== 'Identifier' || declarator.id.name !== 'documents') continue
      if (declarator.init?.type !== 'ObjectExpression') continue

      for (const property of declarator.init.properties) {
        if (property.type !== 'Property') continue
        if (property.key.type !== 'Literal' || typeof property.key.value !== 'string') continue
        // Values are written as `types.SomeDocument`.
        if (property.value.type !== 'MemberExpression') continue
        if (property.value.property.type !== 'Identifier') continue

        result.set(property.key.value, property.value.property.name)
      }
    }
  }

  return result
}

function importedName(specifier: ESTree.ImportSpecifier): string {
  return specifier.imported.type === 'Identifier'
    ? specifier.imported.name
    : String(specifier.imported.value)
}

function isInside(directory: string, path: string): boolean {
  const rel = relative(directory, path)
  return !!rel && !rel.startsWith('..') && !rel.startsWith(sep + '..')
}

function importPathFor(id: string, root: string): string {
  const target = resolve(root, DOCUMENT_NODES_MODULE)
  const rel = relative(dirname(id), target).split(sep).join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

function langFor(id: string): 'ts' | 'tsx' | 'js' | 'jsx' {
  if (id.endsWith('.tsx')) return 'tsx'
  if (id.endsWith('.ts')) return 'ts'
  if (id.endsWith('.jsx')) return 'jsx'
  return 'js'
}

/** Depth-first walk over every node reachable from `root`, in no particular order. */
function walk(root: object, visit: (node: { type: string }) => void): void {
  const stack: unknown[] = [root]
  while (stack.length) {
    const current = stack.pop()
    if (!current || typeof current !== 'object') continue

    if (Array.isArray(current)) {
      stack.push(...current)
      continue
    }
    if (typeof (current as { type?: unknown }).type === 'string') {
      visit(current as { type: string })
    }
    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') stack.push(value)
    }
  }
}
