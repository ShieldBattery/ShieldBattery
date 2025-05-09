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
          AssignedRace: 'Types.AssignedRaceChar',
          DateTime: 'string',
          GameType: 'Types.GameType',
          MapForcePlayerRace: 'Types.MapForcePlayerRace',
          MapVisibility: 'Types.MapVisibility',
          MatchmakingType: 'Types.MatchmakingType',
          Race: 'Types.RaceChar',
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
