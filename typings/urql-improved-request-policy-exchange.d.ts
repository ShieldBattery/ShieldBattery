// urql type augmentation for `client/network/improved-request-policy-exchange.ts`
import '@urql/core'

declare module '@urql/core' {
  interface OperationContext {
    /**
     * Time-to-live (in ms) for this operation, converting it to `cache-and-network` if
     * the last time it had been requested is over this time. If set, this will override the default
     * TTL used by requestPolicyExchange for this operation only.
     */
    ttl?: number
  }
}
