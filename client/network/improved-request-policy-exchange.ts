import type { Exchange, Operation, OperationResult } from '@urql/core'
import { makeOperation } from '@urql/core'
import { map, pipe, tap } from 'wonka'

// This is an improved version of `@urql/exchange-request-policy` that allows us to specify TTL
// overrides for particular operations via `context`, and also uses a monotonic clock for cache
// times instead of `Date`s.

const defaultTTL = 5 * 60 * 1000

// Caps how many distinct operation keys `operations` tracks at once. Without a cap, a long-lived
// session that issues many distinct query+variables combinations over time would grow this map
// forever. When the cap is hit, the oldest entries are evicted; the only effect of evicting an
// entry early is that its operation may be upgraded to `cache-and-network` sooner than its TTL
// would otherwise dictate, which is just a harmless extra refetch.
const MAX_TRACKED_OPERATIONS = 1000

/** Input parameters for the {@link requestPolicyExchange}. */
export interface Options {
  /** Predicate allowing you to selectively not upgrade `Operation`s.
   *
   * @remarks
   * When `shouldUpgrade` is set, it may be used to selectively return a boolean
   * per `Operation`. This allows certain `Operation`s to not be upgraded to a
   * `cache-and-network` policy, when `false` is returned.
   *
   * By default, all `Operation`s are subject to be upgraded.
   * operation to "cache-and-network".
   */
  shouldUpgrade?: (op: Operation) => boolean
  /** The time-to-live (TTL) for which a request policy won't be upgraded.
   *
   * @remarks
   * The `ttl` defines the time frame in which the `Operation` won't be updated
   * with a `cache-and-network` request policy. If an `Operation` is sent again
   * and the `ttl` time period has expired, the policy is upgraded.
   *
   * @defaultValue `300_000` - 5min
   */
  ttl?: number
}

/** Exchange factory that upgrades request policies to `cache-and-network` for queries outside of a defined `ttl`.
 *
 * @param options - An {@link Options} configuration object.
 * @returns the created request-policy {@link Exchange}.
 *
 * @remarks
 * The `requestPolicyExchange` upgrades query operations based on {@link Options.ttl}.
 * The `ttl` defines a timeframe outside of which a query's request policy is set to
 * `cache-and-network` to refetch it in the background.
 *
 * You may define a {@link Options.shouldUpgrade} function to selectively ignore some
 * operations by returning `false` there.
 *
 * @example
 * ```ts
 * requestPolicyExchange({
 *   // Upgrade when we haven't seen this operation for 1 second
 *   ttl: 1000,
 *   // and only upgrade operations that query the `todos` field.
 *   shouldUpgrade: op => op.kind === 'query' && op.query.definitions[0].name?.value === 'todos'
 * });
 * ```
 */
export const requestPolicyExchange =
  (options: Options): Exchange =>
  ({ forward }) => {
    const operations = new Map<number, number>()
    const TTL = (options || {}).ttl || defaultTTL
    const dispatched = new Map<number, number>()
    let counter = 0

    // Sets `key` in `operations`, evicting the oldest entries first if this would exceed
    // `MAX_TRACKED_OPERATIONS`. Deleting an existing key before re-setting it moves it to the end
    // of the map's iteration order, keeping that order an approximation of recency.
    const setOperationTime = (key: number, time: number) => {
      operations.delete(key)
      if (operations.size >= MAX_TRACKED_OPERATIONS) {
        for (const oldestKey of operations.keys()) {
          operations.delete(oldestKey)
          if (operations.size < MAX_TRACKED_OPERATIONS) {
            break
          }
        }
      }
      operations.set(key, time)
    }

    const processIncomingOperation = (operation: Operation): Operation => {
      if (
        operation.kind !== 'query' ||
        (operation.context.requestPolicy !== 'cache-first' &&
          operation.context.requestPolicy !== 'cache-only')
      ) {
        return operation
      }

      const opTtl = operation.context.ttl ?? TTL
      const currentTime = window.performance.now()
      // When an operation passes by we track the current time
      dispatched.set(operation.key, counter)
      queueMicrotask(() => {
        counter = (counter + 1) | 0
      })
      const lastOccurrence = operations.get(operation.key) || 0
      if (
        currentTime - lastOccurrence > opTtl &&
        (!options.shouldUpgrade || options.shouldUpgrade(operation))
      ) {
        return makeOperation(operation.kind, operation, {
          ...operation.context,
          requestPolicy: 'cache-and-network',
        })
      }

      return operation
    }

    const processIncomingResults = (result: OperationResult): void => {
      // When we get a result for the operation we check whether it resolved
      // synchronously by checking whether the counter is different from the
      // dispatched counter.
      const lastDispatched = dispatched.get(result.operation.key) || 0
      // Always remove the dispatched entry once we have a result for it, whether it resolved
      // synchronously (cache hit) or asynchronously (miss) -- otherwise synchronously-resolved
      // operations would never be cleared from `dispatched` and it would grow unbounded.
      dispatched.delete(result.operation.key)
      if (counter !== lastDispatched) {
        // We only update the tracked time in the case of a miss to ensure that cache-and-network
        // is properly taken care of
        setOperationTime(result.operation.key, window.performance.now())
      }
    }

    return ops$ => {
      return pipe(forward(pipe(ops$, map(processIncomingOperation))), tap(processIncomingResults))
    }
  }
