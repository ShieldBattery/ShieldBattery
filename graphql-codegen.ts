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
      config: {
        namingConvention: {
          enumValues: 'change-case-all#pascalCase',
        },
        scalars: {
          DateTime: 'string',
          SbUserId: 'Types.SbUserId',
          UUID: 'string',
        },
        strictScalars: true,
      },
      plugins: [
        {
          add: {
            content: "import * as Types from './types'",
          },
        },
      ],
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
