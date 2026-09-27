import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery } from 'urql'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { SbUserId } from '../../common/users/sb-user-id'
import { graphql } from '../gql'
import { GameFeedbackKind } from '../gql/graphql'
import { useSnackbarController } from '../snackbars/snackbar-overlay'

const GameFeedbackQuery = graphql(/* GraphQL */ `
  query GameFeedback($gameId: UUID!) {
    gameFeedback(gameId: $gameId) {
      id
      closesAt
      given {
        userId
        kind
      }
      commendsRemaining
      commendsAvailableAt
      recentCommends {
        userId
        availableAt
      }
    }
  }
`)

const CommendPlayerMutation = graphql(/* GraphQL */ `
  mutation CommendPlayer($gameId: UUID!, $userId: SbUserId!) {
    commendPlayer(gameId: $gameId, userId: $userId) {
      feedback {
        id
        closesAt
        given {
          userId
          kind
        }
        commendsRemaining
        commendsAvailableAt
        recentCommends {
          userId
          availableAt
        }
      }
      commendedUser {
        id
        commendCount
      }
    }
  }
`)

/** Whether the current user can commend a particular player right now. */
export type CommendAvailability =
  | { kind: 'available' }
  /** Commended within the last day (in any game), or the daily limit was reached. */
  | { kind: 'blocked'; reason: 'recent' | 'limit'; until?: Date }

/**
 * Works out whether the current user can commend `userId` at `now`, given when their cooldown on
 * each recently commended player ends (`recentUntil`), how many commends they have left, and when
 * the next one frees up (`limitUntil`). When both limits apply, the one that lifts later is named,
 * since that's when commending actually becomes possible again.
 */
export function getCommendAvailability(
  userId: SbUserId,
  {
    now,
    recentUntil,
    commendsRemaining,
    limitUntil,
  }: {
    now: number
    recentUntil: ReadonlyMap<SbUserId, number>
    commendsRemaining: number
    limitUntil: number | undefined
  },
): CommendAvailability {
  const recent = recentUntil.get(userId)
  const isRecent = recent !== undefined && recent > now
  const isLimited = commendsRemaining <= 0
  if (isRecent && (!isLimited || limitUntil === undefined || recent >= limitUntil)) {
    return { kind: 'blocked', reason: 'recent', until: new Date(recent) }
  }
  if (isLimited) {
    return {
      kind: 'blocked',
      reason: 'limit',
      until: limitUntil !== undefined ? new Date(limitUntil) : undefined,
    }
  }
  return { kind: 'available' }
}

export interface GameFeedbackState {
  /**
   * The players the current user can still commend or report in this game: those passed in that
   * haven't been commended or reported yet, while the game's feedback window is open. Empty when
   * the window is closed, the game has no results, or the current user didn't play in it.
   */
  candidates: ReadonlyArray<SbUserId>
  commendAvailability: (userId: SbUserId) => CommendAvailability
  /** Commends `userId` right away (optimistically) and shows a snackbar either way. */
  commend: (userId: SbUserId, name: string) => void
}

/**
 * The current user's commend/report state for a game, for the players in `otherPlayerIds` (the
 * other humans in it). Pass `enabled: false` when the current user can't have any (e.g. they
 * didn't play), so no query is made.
 */
export function useGameFeedback(
  gameId: string,
  otherPlayerIds: ReadonlyArray<SbUserId>,
  enabled: boolean,
): GameFeedbackState {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [{ data }, reexecuteQuery] = useQuery({
    query: GameFeedbackQuery,
    variables: { gameId },
    pause: !enabled,
    context: { suspense: false },
  })
  const [, commendPlayer] = useMutation(CommendPlayerMutation)
  const feedback = data?.gameFeedback

  // Commends sent from this page that the server hasn't confirmed yet. They hide their player's
  // options immediately, and are dropped again if the commend fails.
  const [pendingCommends, setPendingCommends] = useState<ReadonlySet<SbUserId>>(new Set())
  const [now, setNow] = useState(() => Date.now())

  const closesAt = feedback?.closesAt ? Date.parse(feedback.closesAt) : undefined
  const recentUntil = new Map<SbUserId, number>()
  for (const r of feedback?.recentCommends ?? []) {
    recentUntil.set(r.userId, Date.parse(r.availableAt))
  }
  const limitUntil = feedback?.commendsAvailableAt
    ? Date.parse(feedback.commendsAvailableAt)
    : undefined

  // Wake up at the next moment something here changes on its own (the window closing, a cooldown or
  // the daily limit lifting) and refetch, since the server's view is the one that counts.
  const nextChange = [closesAt, limitUntil, ...recentUntil.values()]
    .filter((time): time is number => time !== undefined && time > now)
    .reduce<number | undefined>(
      (min, time) => (min === undefined || time < min ? time : min),
      undefined,
    )
  useEffect(() => {
    if (nextChange === undefined) {
      return undefined
    }
    const timeout = setTimeout(
      () => {
        setNow(Date.now())
        reexecuteQuery({ requestPolicy: 'network-only' })
      },
      // A little past the boundary, so the server agrees it has passed
      nextChange - Date.now() + 1000,
    )
    return () => clearTimeout(timeout)
  }, [nextChange, reexecuteQuery])

  const given = new Set<SbUserId>(pendingCommends)
  for (const g of feedback?.given ?? []) {
    given.add(g.userId)
  }
  const isOpen = closesAt !== undefined && now < closesAt
  const candidates = isOpen ? otherPlayerIds.filter(id => !given.has(id)) : []

  const serverCommendedIds = new Set(
    (feedback?.given ?? []).filter(g => g.kind === GameFeedbackKind.Commend).map(g => g.userId),
  )
  const unconfirmedCount = [...pendingCommends].filter(id => !serverCommendedIds.has(id)).length
  const commendsRemaining = (feedback?.commendsRemaining ?? 0) - unconfirmedCount

  const commendAvailability = (userId: SbUserId): CommendAvailability =>
    getCommendAvailability(userId, { now, recentUntil, commendsRemaining, limitUntil })

  const commend = (userId: SbUserId, name: string) => {
    if (!candidates.includes(userId) || commendAvailability(userId).kind !== 'available') {
      return
    }

    setPendingCommends(prev => new Set(prev).add(userId))
    snackbarController.showSnackbar(
      t('gameCommend.sent', { defaultValue: 'You commended {{user}}.', user: name }),
    )

    commendPlayer({ gameId, userId })
      .then(result => {
        if (!result.error) {
          return
        }

        setPendingCommends(prev => {
          const next = new Set(prev)
          next.delete(userId)
          return next
        })
        // Whatever went wrong, the server's current view is the one to show
        reexecuteQuery({ requestPolicy: 'network-only' })

        const code = result.error.graphQLErrors?.[0]?.extensions?.code
        let message: string
        switch (code) {
          case 'FEEDBACK_CLOSED':
            message = t(
              'gameCommend.errors.closed',
              'Commends and reports for this game are closed.',
            )
            break
          case 'ALREADY_COMMENDED':
            message = t(
              'gameCommend.errors.alreadyCommended',
              "You've already commended this player for this game.",
            )
            break
          case 'ALREADY_REPORTED':
            message = t(
              'gameCommend.errors.alreadyReported',
              "You've already reported this player for this game.",
            )
            break
          case 'COMMENDED_RECENTLY':
            message = t('gameCommend.errors.commendedRecently', {
              defaultValue: 'You already commended {{user}} in the last 24 hours.',
              user: name,
            })
            break
          case 'RATE_LIMITED':
            message = t(
              'gameCommend.errors.rateLimited',
              "You've reached today's limit of 10 commends.",
            )
            break
          default:
            message = t('gameCommend.errors.generic', {
              defaultValue: "Your commend for {{user}} didn't go through. Please try again.",
              user: name,
            })
        }
        snackbarController.showSnackbar(message)
      })
      .catch(swallowNonBuiltins)
  }

  return { candidates, commendAvailability, commend }
}
