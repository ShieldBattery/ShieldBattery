import { cacheExchange, UpdatesConfig } from '@urql/exchange-graphcache'
import { requestPolicyExchange } from '@urql/exchange-request-policy'
import { Client, fetchExchange } from 'urql'
import { ServerConfig } from '../../common/server-config'
import { CREDENTIAL_STORAGE } from './fetch'

export function createGraphqlClient(serverConfig: ServerConfig) {
  const url = new URL(serverConfig.graphqlOrigin)
  url.pathname = '/gql'

  const schema = require('../gql/schema.json')

  return new Client({
    url: url.toString(),
    exchanges: [
      requestPolicyExchange({
        ttl: 5 * 60 * 1000,
        shouldUpgrade: operation => operation.context.requestPolicy !== 'cache-only',
      }),
      cacheExchange({ schema, updates: cacheUpdates }),
      fetchExchange,
    ],
    suspense: true,
    fetchOptions: () => {
      const jwt = CREDENTIAL_STORAGE.get()
      return jwt
        ? {
            headers: {
              Authorization: `Bearer ${jwt}`,
            },
          }
        : {}
    },
  })
}

// TODO(tec27): Devise a way to split this between the different feature areas
const cacheUpdates: UpdatesConfig = {
  Mutation: {
    deleteRestrictedName: (result, args, cache) => {
      if (result.deleteRestrictedName) {
        cache.invalidate({
          __typename: 'NameRestriction',
          id: args.id as any,
        })
      }
    },
  },
}
