// Configuration for @graphql-codegen/cli

import { CodegenConfig } from '@graphql-codegen/cli'

export default {
  schema: 'schema.graphql',
  documents: ['client/**/*.{js,jsx,ts,tsx}', '!client/gql/**'],
  ignoreNoDocuments: true,
  generates: {
    'client/gql/': {
      preset: 'client',
      hooks: {
        afterOneFileWrite: ['prettier --write'],
      },
    },
    'client/gql/schema.json': {
      plugins: ['introspection'],
      config: {
        minify: true,
        descriptions: false,
        schemaDescription: false,
      },
    },
  },
} satisfies CodegenConfig
