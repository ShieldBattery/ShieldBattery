import { cacheExchange } from '@urql/exchange-graphcache'
import { requestPolicyExchange } from '@urql/exchange-request-policy'
import { Client, fetchExchange } from 'urql'
import { ServerConfig } from '../../common/server-config'
import { dispatch } from '../dispatch-registry'

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
      cacheExchange({ schema }),
      fetchExchange,
    ],
    suspense: true,
    fetchOptions: () => {
      let sessionId: string | undefined
      dispatch((_, getState) => {
        const { auth } = getState()
        sessionId = auth.self?.sessionId
      })

      return sessionId
        ? {
            headers: {
              'Sb-Session-Id': sessionId,
            },
          }
        : {}
    },
  })
}
