import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseSync } from 'rolldown/utils'
import { beforeAll, describe, expect, test } from 'vitest'
import { graphqlOptimizer } from './graphql-optimizer'

const FOO_QUERY = '\n  query Foo {\n    bar\n  }\n'
const BAZ_FRAGMENT = '\n  fragment Baz on Qux {\n    id\n  }\n'

/** Shaped like what graphql-codegen's client preset writes, down to the escaped keys. */
const GENERATED_DOCUMENTS = `
import * as types from './graphql'

type Documents = {
  ${JSON.stringify(FOO_QUERY)}: typeof types.FooDocument
  ${JSON.stringify(BAZ_FRAGMENT)}: typeof types.BazFragmentDoc
}

const documents: Documents = {
  ${JSON.stringify(FOO_QUERY)}: types.FooDocument,
  ${JSON.stringify(BAZ_FRAGMENT)}: types.BazFragmentDoc,
}

export function graphql(source: string) {
  return (documents as any)[source] ?? {}
}
`

let root: string
let gqlDir: string
let plugin: any

/**
 * Enough of a plugin context for the hooks under test. `resolve` mimics the real resolver only
 * insofar as the plugin cares: whether a specifier lands inside `client/gql`.
 */
function pluginContext() {
  return {
    parse: (code: string, options?: { lang?: string }) =>
      parseSync(`input.${options?.lang ?? 'ts'}`, code, { lang: options?.lang as never }).program,
    resolve: async (source: string) => {
      if (source.endsWith('/gql') || source.endsWith('/gql/index')) {
        return { id: join(gqlDir, 'index.ts') }
      }
      if (source.endsWith('/graphql')) return { id: join(gqlDir, 'graphql.ts') }
      return { id: join(root, 'client', `${source.replaceAll('.', '_')}.ts`) }
    },
    addWatchFile: () => {},
    warn: () => {},
  }
}

/**
 * Runs the code filter before the handler, the way rolldown does. Calling the handler directly
 * would hide a filter that never matches.
 */
async function transform(code: string, file = 'client/feature/thing.tsx') {
  const include = plugin.transform.filter.code.include as string
  if (!code.includes(include)) return null

  const context = pluginContext()
  return await plugin.transform.handler.call(context, code, resolve(root, file))
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'sb-gql-'))
  gqlDir = join(root, 'client', 'gql')
  await mkdir(gqlDir, { recursive: true })
  await mkdir(join(root, 'client', 'feature'), { recursive: true })
  await writeFile(join(gqlDir, 'gql.ts'), GENERATED_DOCUMENTS, 'utf8')

  plugin = graphqlOptimizer(root) as any
  await plugin.buildStart.call(pluginContext())
})

describe('build-plugins/graphqlOptimizer', () => {
  test('rewrites a matching call to an aliased import of the document', async () => {
    const result = await transform(
      `import { graphql } from '../gql'\nconst q = graphql(\`${FOO_QUERY}\`)\n`,
    )

    expect(result.code).toContain('import { FooDocument as __sbGqlDocument_FooDocument } from')
    expect(result.code).toContain('const q = __sbGqlDocument_FooDocument')
    // The query text itself is gone, which is the entire point.
    expect(result.code).not.toContain('query Foo')
  })

  test('follows the local name when the import is aliased', async () => {
    const result = await transform(
      `import { graphql as gql } from '../gql'\nconst q = gql(\`${FOO_QUERY}\`)\n`,
    )

    expect(result.code).toContain('const q = __sbGqlDocument_FooDocument')
  })

  test('maps fragments as well as operations', async () => {
    const result = await transform(
      `import { graphql } from '../gql'\nconst f = graphql(\`${BAZ_FRAGMENT}\`)\n`,
    )

    expect(result.code).toContain('const f = __sbGqlDocument_BazFragmentDoc')
  })

  test('imports the document module relative to the file being transformed', async () => {
    const nested = await transform(
      `import { graphql } from '../../gql'\nconst q = graphql(\`${FOO_QUERY}\`)\n`,
      'client/a/b/deep.tsx',
    )

    expect(nested.code).toContain("from '../../gql/graphql'")
  })

  test('leaves calls alone when graphql came from somewhere else', async () => {
    const result = await transform(
      `import { graphql } from 'graphql'\nconst q = graphql(\`${FOO_QUERY}\`)\n`,
    )

    expect(result).toBeNull()
  })

  test('leaves interpolated templates alone', async () => {
    const result = await transform(
      'import { graphql } from \'../gql\'\nconst x = "y"\nconst q = graphql(`${x}`)\n',
    )

    expect(result).toBeNull()
  })

  test('leaves unknown query strings to the runtime lookup', async () => {
    const result = await transform(
      `import { graphql } from '../gql'\nconst q = graphql(\`\n  query Absent {\n    nope\n  }\n\`)\n`,
    )

    expect(result).toBeNull()
  })

  test('aliases so a document name already bound in the file cannot collide', async () => {
    const result = await transform(
      `import { graphql } from '../gql'\n` +
        `import { FooDocument } from '../gql/graphql'\n` +
        `const q = graphql(\`${FOO_QUERY}\`)\n` +
        `const also = FooDocument\n`,
    )

    // Both bindings survive: the pre-existing one under its own name, ours under the alias.
    expect(result.code).toContain('const also = FooDocument')
    expect(result.code).toContain('const q = __sbGqlDocument_FooDocument')
  })
})
