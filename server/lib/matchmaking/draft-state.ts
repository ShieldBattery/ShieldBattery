import { nanoid } from 'nanoid'
import { ReadonlyDeep } from 'type-fest'
import { raceAbort } from '../../../common/async/abort-signals'
import createDeferred from '../../../common/async/deferred'
import { GameDraftMessage } from '../../../common/games/games'
import { MapInfo, toMapInfoJson } from '../../../common/maps'
import {
  AnonymizedDraftPlayer,
  AnonymizedNameIndex,
  ClientDraftState,
  DRAFT_PICK_TIME_MS,
  DraftMessageType,
  DraftPlayer,
  MatchmakingEvent,
  MatchmakingServiceErrorCode,
} from '../../../common/matchmaking'
import { RaceChar } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user-id'
import filterChatMessage from '../messaging/filter-chat-message'
import { processMessageContents } from '../messaging/process-chat-message'
import { ClientSocketsGroup } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import { calcEffectiveRating, MatchmakingPlayer } from './matchmaking-entity'
import { MatchmakingServiceError } from './matchmaking-service-error'
import { getMatchPath, getMatchTeamPath } from './matchmaking-socket-paths'
import { ZenMatchSnapshot } from './zen-mode'

/**
 * Creates a snake pick order (A0 B0 B1 A1 A2 B2 ...) for two teams of `teamSize` players. Races
 * aren't exclusive, so the only advantage a later pick has is seeing more of the opposing team's
 * races; the lower-rated team is given the final pick as a handicap. With an even team size the
 * team that picks first also picks last, so which team leads depends on the team size.
 */
export function createSnakePickOrder(
  teamSize: number,
  lowerRatedTeam: number,
): Array<{ team: number; slot: number }> {
  const higherRatedTeam = lowerRatedTeam === 0 ? 1 : 0
  const firstTeam = teamSize % 2 === 0 ? lowerRatedTeam : higherRatedTeam
  const secondTeam = firstTeam === 0 ? 1 : 0

  const pickOrder: Array<{ team: number; slot: number }> = []
  for (let slot = 0; slot < teamSize; slot++) {
    const [leading, trailing] = slot % 2 === 0 ? [firstTeam, secondTeam] : [secondTeam, firstTeam]
    pickOrder.push({ team: leading, slot }, { team: trailing, slot })
  }
  return pickOrder
}

type DraftRosterPlayer = DraftPlayer & { nameIndex: AnonymizedNameIndex; zenMuted: boolean }

export class DraftState {
  private teams: Array<{ players: DraftRosterPlayer[] }>
  private pickOrder: Array<{ team: number; slot: number }>
  private isComplete = false
  private currentPickerIndex = -1
  private chatLog: GameDraftMessage[] = []

  private pickTimeout?: NodeJS.Timeout
  private completionNotifier = createDeferred<void>()
  private cleanupSubscriptions: () => void

  constructor(
    readonly matchId: string,
    matchTeams: ReadonlyDeep<MatchmakingPlayer[][]>,
    readonly mapInfo: MapInfo,
    private abortController: AbortController,
    private publisher: TypedPublisher<ReadonlyDeep<MatchmakingEvent>>,
    activeClients: Map<SbUserId, ClientSocketsGroup>,
    private zenSnapshot: ZenMatchSnapshot,
  ) {
    const zenPlayers = new Map(zenSnapshot.players.map(player => [player.userId, player]))
    // Initialize teams with players sorted by MMR (lowest first within each team)
    this.teams = matchTeams.map(team => ({
      players: team
        .slice() // Don't mutate original array
        .sort((a, b) => a.rating - b.rating) // Sort by MMR ascending (lowest first)
        .map(player => {
          const zenPlayer = zenPlayers.get(player.id)
          if (!zenPlayer) {
            throw new Error(`Missing draft alias for player ${player.id}`)
          }
          return {
            userId: player.id,
            provisionalRace: player.race,
            hasLocked: false,
            nameIndex: zenPlayer.nameIndex,
            zenMuted: zenPlayer.muteChat,
          }
        }),
    }))

    const lowerRatedTeam =
      calcEffectiveRating(matchTeams[0]) < calcEffectiveRating(matchTeams[1]) ? 0 : 1
    this.pickOrder = createSnakePickOrder(this.teams[0].players.length, lowerRatedTeam)

    this.cleanupSubscriptions = this.setupSubscriptions(activeClients)

    Promise.resolve()
      .then(async () => {
        this.abortController.signal.throwIfAborted()
        // Initial animations + delay so players can get their bearings
        await raceAbort(
          this.abortController.signal,
          new Promise(resolve => setTimeout(resolve, 5000)),
        )
        this.advanceToNextPicker()
      })
      .catch(err => {
        this.completionNotifier.reject(err)
      })
  }

  /**
   * Sets up draft subscriptions for all players.
   */
  private setupSubscriptions(activeClients: Map<SbUserId, ClientSocketsGroup>): () => void {
    const cleanupFuncs: Array<() => void> = []

    for (let i = 0; i < this.teams.length; i++) {
      const teamPath = getMatchTeamPath(this.matchId, i)
      for (const player of this.teams[i].players) {
        const clientSockets = activeClients.get(player.userId)
        if (clientSockets) {
          // NOTE(tec27): We assume that the matchmaking service will notify us if a client
          // disconnects so we don't need to track that with this subscription
          clientSockets.subscribe<MatchmakingEvent>(teamPath, () => {
            return {
              type: 'draftStarted',
              draftState: this.getClientDraftState(player.userId),
              mapInfo: toMapInfoJson(this.mapInfo),
            }
          })
          cleanupFuncs.push(() => {
            clientSockets.unsubscribe(teamPath)
          })
        }
      }
    }

    // Setup cleanup when draft completes or is aborted
    raceAbort(this.abortController.signal, this.completionNotifier)
      .catch(err => {
        this.completionNotifier.reject(err)
      })
      .finally(() => {
        this.cleanup()
      })

    return () => {
      for (const cleanup of cleanupFuncs) {
        cleanup()
      }
    }
  }

  /**
   * Cleans up subscriptions when draft completes or is aborted.
   */
  private cleanup(): void {
    this.cleanupSubscriptions()

    if (this.pickTimeout) {
      clearTimeout(this.pickTimeout)
      this.pickTimeout = undefined
    }

    // If the completion notifier hadn't been resolved yet, wake up anything waiting on it
    this.completionNotifier.reject(new Error('Draft aborted'))
  }

  /**
   * Returns a Promise that resolves when the draft completes.
   */
  get completedPromise(): Promise<void> {
    return this.completionNotifier
  }

  handleClientLeave(): void {
    this.abortController.abort()
  }

  getCurrentPicker(): { userId: SbUserId; team: number; slot: number } | undefined {
    if (this.isComplete || this.currentPickerIndex < 0) {
      return undefined
    }

    const currentPicker = this.pickOrder[this.currentPickerIndex]
    const player = this.teams[currentPicker.team].players[currentPicker.slot]
    return {
      userId: player.userId,
      team: currentPicker.team,
      slot: currentPicker.slot,
    }
  }

  updateProvisionalRace(userId: SbUserId, race: RaceChar): void {
    if (this.isComplete) {
      return
    }

    let teamIndex = -1
    let slotIndex = -1
    for (let i = 0; i < this.teams.length; i++) {
      const playerIndex = this.teams[i].players.findIndex(p => p.userId === userId)
      if (playerIndex !== -1) {
        teamIndex = i
        slotIndex = playerIndex
        break
      }
    }
    if (teamIndex === -1 || slotIndex === -1) {
      throw new Error(`Player ${userId} not found in any team`)
    }

    const player = this.teams[teamIndex].players[slotIndex]
    if (player.hasLocked) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.InvalidDraftPick,
        `Player ${userId} has already locked in their pick`,
      )
    }

    player.provisionalRace = race
    this.publisher.publish(getMatchTeamPath(this.matchId, teamIndex), {
      type: 'draftProvisionalPick',
      teamId: teamIndex,
      index: slotIndex,
      race,
    })
  }

  lockInPick(userId: SbUserId, race: RaceChar) {
    if (this.isComplete) {
      return
    }

    const player = this.findPlayer(userId)!
    if (player.hasLocked) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.InvalidDraftPick,
        `Player ${userId} has already locked in their pick`,
      )
    }

    const currentPicker = this.getCurrentPicker()
    if (!currentPicker || currentPicker.userId !== userId) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.InvalidDraftPick,
        `Player ${userId} is not the current picker`,
      )
    }

    this.teams[currentPicker.team].players[currentPicker.slot] = {
      ...player,
      provisionalRace: race,
      hasLocked: true,
      finalRace: race,
    }

    if (this.pickTimeout) {
      clearTimeout(this.pickTimeout)
      this.pickTimeout = undefined
    }

    this.publisher.publish(getMatchPath(this.matchId), {
      type: 'draftPickLocked',
      teamId: currentPicker.team,
      index: currentPicker.slot,
      race,
    })

    Promise.resolve()
      .then(async () => {
        this.abortController.signal.throwIfAborted()
        // Wait a bit between each player/at the end of the draft
        await raceAbort(
          this.abortController.signal,
          new Promise(resolve => setTimeout(resolve, 2000)),
        )
        this.advanceToNextPicker()
      })
      .catch(err => {
        this.completionNotifier.reject(err)
      })
  }

  private handlePickTimeout() {
    const currentPicker = this.getCurrentPicker()
    if (!currentPicker) {
      return // Draft is complete or invalid state
    }

    // Auto-assign provisional race
    const player = this.findPlayer(currentPicker.userId)!
    if (!player.hasLocked) {
      this.lockInPick(currentPicker.userId, player.provisionalRace)
    }
  }

  private advanceToNextPicker() {
    this.checkIfComplete()
    if (this.isComplete) {
      return
    }

    // Find first unlocked player in pick order
    for (let i = 0; i < this.pickOrder.length; i++) {
      const pickSlot = this.pickOrder[i]
      const player = this.teams[pickSlot.team].players[pickSlot.slot]
      if (!player.hasLocked) {
        this.currentPickerIndex = i
        this.publisher.publish(getMatchPath(this.matchId), {
          type: 'draftPickStarted',
          teamId: pickSlot.team,
          index: pickSlot.slot,
        })
        this.startPickTimer()
        break
      }
    }
  }

  private startPickTimer() {
    if (this.isComplete) {
      return
    }

    // Add ~2 second leeway for network latency
    const timeoutMs = DRAFT_PICK_TIME_MS + 2000

    this.pickTimeout = setTimeout(() => {
      this.handlePickTimeout()
    }, timeoutMs)
  }

  private checkIfComplete() {
    if (this.isComplete) {
      return
    }

    const complete = this.teams.every(team => team.players.every(player => player.hasLocked))
    if (complete) {
      this.isComplete = true
      this.completionNotifier.resolve()

      this.publisher.publish(getMatchPath(this.matchId), {
        type: 'draftCompleted',
      })
    }
  }

  getFinalRaces(): Map<SbUserId, RaceChar> {
    const finalRaces = new Map<SbUserId, RaceChar>()

    for (const team of this.teams) {
      for (const player of team.players) {
        if (player.hasLocked) {
          finalRaces.set(player.userId, player.finalRace)
        }
      }
    }

    return finalRaces
  }

  /**
   * The chat sent so far in this draft, in the order it was sent, with the text as its sender wrote
   * it (rather than with mentions converted to their markup).
   */
  getChatLog(): ReadonlyArray<Readonly<GameDraftMessage>> {
    return this.chatLog
  }

  async sendChatMessage(userId: SbUserId, message: string) {
    const teamIndex = this.teams.findIndex(team => team.players.some(p => p.userId === userId))
    if (teamIndex === -1) {
      throw new Error(`Player ${userId} not found in any team`)
    }

    if (this.zenSnapshot.settings.get(userId)?.muteChat) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.ZenChatMuted,
        'Draft chat is muted',
      )
    }

    const text = filterChatMessage(message)
    const [processedText, mentions, channelMentions] = await processMessageContents(text)
    const time = Date.now()
    this.chatLog.push({ userId, sentAt: new Date(time), text })
    this.publisher.publish(getMatchTeamPath(this.matchId, teamIndex), {
      type: 'draftChatMessage',
      message: {
        id: nanoid(),
        type: DraftMessageType.TextMessage,
        time,
        from: userId,
        text: processedText,
      },
      mentions,
      channelMentions,
    })
  }

  private getAnonymizedTeam(teamIndex: number): { players: AnonymizedDraftPlayer[] } {
    const team = this.teams[teamIndex]
    return {
      players: team.players.map((player, index): AnonymizedDraftPlayer => {
        if (player.hasLocked) {
          return {
            index,
            nameIndex: player.nameIndex,
            zenMuted: player.zenMuted,
            hasLocked: true,
            finalRace: player.finalRace,
          }
        } else {
          return {
            index,
            nameIndex: player.nameIndex,
            zenMuted: player.zenMuted,
            hasLocked: false,
          }
        }
      }),
    }
  }

  private getClientDraftState(userId: SbUserId): ClientDraftState {
    const userTeamIndex = this.teams.findIndex(team => team.players.some(p => p.userId === userId))
    if (userTeamIndex === -1) {
      throw new Error(`User ${userId} not found in any team`)
    }

    const opponentTeamIndex = userTeamIndex === 0 ? 1 : 0

    const currentPicker = this.getCurrentPicker()

    return {
      matchId: this.matchId,
      zenMode: this.zenSnapshot.settings.get(userId),
      mapId: this.mapInfo.id,
      currentPicker: currentPicker
        ? { team: currentPicker.team, slot: currentPicker.slot }
        : undefined,
      myTeamIndex: userTeamIndex,
      ownTeam: this.teams[userTeamIndex],
      opponentTeam: this.getAnonymizedTeam(opponentTeamIndex),
      pickOrder: this.pickOrder.map(({ team, slot }) => [team, slot]),
      isCompleted: this.isComplete,
    }
  }

  private findPlayer(userId: SbUserId): DraftRosterPlayer | undefined {
    for (const team of this.teams) {
      const player = team.players.find(p => p.userId === userId)
      if (player) {
        return player
      }
    }
    return undefined
  }
}
