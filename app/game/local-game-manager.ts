import { app } from 'electron'
import { ChildProcess, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { GameLaunchConfig, PlayerInfo } from '../../common/games/game-launch-config'
import { GameType } from '../../common/games/game-type'
import { LocalGameRequest, LocalGameStatus } from '../../common/games/local-game'
import HashThrough from '../../common/hash-through'
import { SlotType } from '../../common/lobbies/slot'
import { BwUserLatency } from '../../common/network'
import { makeSbUserId } from '../../common/users/sb-user-id'
import log from '../logger'
import { LocalSettingsManager, ScrSettingsManager } from '../settings'
import { ActiveGameManager } from './active-game-manager'
import { GameServer } from './game-server'
import { LocalGameHub } from './local-game-hub'
import { MapStore } from './map-store'

const BOT_RESULT_TIMEOUT = 3000
const LOCAL_RESULT_SETTLE_TIMEOUT = 1000

interface Session {
  status: LocalGameStatus
  managers: ActiveGameManager[]
  workers: ChildProcess[]
  detach: Array<() => void>
  hub?: LocalGameHub
  control?: { endpoint: string; dispose: () => void }
  timer?: ReturnType<typeof setTimeout>
  stopping: boolean
  stopped?: Promise<void>
}

/** Owns one practice match and every process launched to support it. */
export class LocalGameManager extends EventEmitter<{ status: [status: LocalGameStatus] }> {
  private session?: Session
  private launching = false
  private launchCanceled = false

  constructor(
    private playerManager: ActiveGameManager,
    private gameServer: GameServer,
    private mapStore: MapStore,
    private localSettings: LocalSettingsManager,
    private scrSettings: ScrSettingsManager,
  ) {
    super()
  }

  getStatus(): LocalGameStatus | undefined {
    return this.session ? structuredClone(this.session.status) : undefined
  }

  getManager(gameId: string): ActiveGameManager | undefined {
    return this.session?.managers.find(manager => manager.getStatus()?.id === gameId)
  }

  isActive(): boolean {
    return (
      this.launching ||
      (!!this.session && !['finished', 'error'].includes(this.session.status.state))
    )
  }

  async start(request: LocalGameRequest): Promise<LocalGameStatus> {
    if (
      this.launching ||
      (this.session &&
        !this.session.stopping &&
        !['finished', 'error'].includes(this.session.status.state))
    ) {
      throw new Error('A local game is already active')
    }
    if (this.playerManager.getStatus()) throw new Error('Another game is already active')
    this.launching = true
    this.launchCanceled = false
    let session: Session | undefined
    try {
      await this.session?.stopped
      validateRequest(request)
      await this.verifyFiles(request)
      if (this.launchCanceled) throw new Error('Local game launch canceled')
      const id = randomUUID()
      const playerGameId = randomUUID()
      const botGameIds = request.bots.map(() => randomUUID())
      session = {
        status: { id, state: 'launching', playerGameId, botGameIds },
        managers: [],
        workers: [],
        detach: [],
        stopping: false,
      }
      this.session = session
      this.publish(session)
      const owned = session
      const fail = (error: Error) => {
        const state = this.playerManager.getStatus()?.state
        const finished = state === 'hasResult' || state === 'resultSent' || state === 'finished'
        this.stopSession(owned, finished ? undefined : error).catch(err => log.error(String(err)))
      }
      session.control = await this.gameServer.createLocalControlPipe()
      if (session.stopping) {
        session.control.dispose()
        throw new Error('Local game launch canceled')
      }
      const secret = randomBytes(32).toString('hex')
      const endpoint = `\\\\.\\pipe\\ShieldBattery.LocalGame.${id}`
      session.hub = new LocalGameHub(endpoint, secret, request.bots.length + 1, fail)
      await session.hub.listen()
      if (session.stopping) throw new Error('Local game launch canceled')
      // The host has to sit at session slot 0. A playing human hosts; a watching human leaves
      // hosting to the first bot and takes the last session slot from an observer seat.
      const observing = !!request.player.observer
      // Top vs bottom seats the human alone on top against every bot, so it needs a playing human.
      const gameType =
        request.gameType === GameType.TopVsBottom && observing
          ? GameType.FreeForAll
          : (request.gameType ?? GameType.Melee)
      const teamGame = gameType === GameType.TopVsBottom
      // Team ids only mean something in a team game; the human (slot 0) is team 1, bots team 2.
      const teamIdFor = (slot: number) => {
        if (!teamGame) {
          return 0
        }
        return slot === 0 ? 1 : 2
      }
      const players = observing
        ? [...request.bots, request.player]
        : [request.player, ...request.bots]
      const humanSlot = observing ? request.bots.length : 0
      const botIndexOf = (slot: number) => (observing ? slot : slot - 1)
      // User ids don't follow seating: the human is always user 1, so the renderer can find its
      // own result, and bot i is user i + 2.
      const users = players.map((player, slot) => ({
        id: makeSbUserId(slot === humanSlot ? 1 : botIndexOf(slot) + 2),
        name: player.name,
        created: 0,
      }))
      const seated = observing ? request.bots : players
      const slots: PlayerInfo[] = Array.from({ length: 8 }, (_, slot) => ({
        id: `local-${slot}`,
        // Only bots have replay names; a negative index (the playing human's seat) finds none.
        replayName: request.bots[botIndexOf(slot)]?.replayName,
        userId: slot < seated.length ? users[slot].id : undefined,
        race: seated[slot]?.race ?? 'r',
        playerId: slot,
        teamId: teamIdFor(slot),
        type: slot < seated.length ? SlotType.Human : SlotType.Closed,
        typeId: 6,
      }))
      if (observing) {
        slots.push({
          id: 'local-observer',
          userId: users[humanSlot].id,
          race: 'r',
          playerId: 0,
          teamId: 0,
          type: SlotType.Observer,
          typeId: 0,
        })
      }
      const roster = users.map((user, slot) => ({ slot, userId: user.id }))
      const seed = randomBytes(4).readUInt32LE()
      const logDirectory = path.join(app.getPath('userData'), 'logs', 'local-games', id)
      await fs.mkdir(logDirectory, { recursive: true })
      if (session.stopping) throw new Error('Local game launch canceled')

      for (let slot = 0; slot < players.length; slot++) {
        const isHuman = slot === humanSlot
        const botIndex = botIndexOf(slot)
        const gameId = isHuman ? playerGameId : botGameIds[botIndex]
        const manager = isHuman
          ? this.playerManager
          : new ActiveGameManager(this.mapStore, this.localSettings, this.scrSettings)
        manager.setLocalControlPipe(session.control.endpoint)
        session.managers.push(manager)
        session.detach.push(this.gameServer.registerManager(gameId, manager))
        const onExit = () => {
          if (session!.stopping) return
          if (!isHuman && owned.status.state === 'playing') {
            // A bot that is out of the game (defeated, or crashed) closes its client while the
            // others play on; the session ends with the human's game, not with the bot's.
            log.warning(`Bot client ${botIndex + 1} exited during the game`)
            return
          }
          this.stopSession(
            owned,
            isHuman ? undefined : new Error(`Bot client ${botIndex + 1} exited`),
          ).catch(err => log.error(String(err)))
        }
        const onStatus = () => {
          const status = manager.getStatus()
          if (status?.state === 'error')
            fail(new Error(String(status.extra ?? 'Game launch failed')))
          if (isHuman && status?.state === 'playing' && !owned.stopping) {
            clearTimeout(owned.timer)
            owned.status.state = 'playing'
            this.publish(owned)
          }
          if (!isHuman && observing && !owned.stopping && this.allBotsFinished(owned)) {
            // A watcher has no result of its own to wait for: once every bot's game has one, the
            // game is over, and the observer's client would otherwise sit at BW's timeout dialog.
            this.stopSession(owned).catch(err => log.error(String(err)))
          }
        }
        manager.on('gameExit', onExit)
        manager.on('gameStatus', onStatus)
        session.detach.push(() => {
          manager.off('gameExit', onExit)
          manager.off('gameStatus', onStatus)
        })
        const instance = isHuman ? undefined : randomUUID()
        if (!isHuman) {
          const bot = request.bots[botIndex]
          await this.startBot(
            session,
            manager,
            {
              executable: bot.executable,
              args: bot.args ?? [],
              cwd: bot.workingDirectory,
              instance: instance!,
              logPath: path.join(logDirectory, `bot-${botIndex + 1}.log`),
            },
            fail,
          )
        }
        if (session.stopping) throw new Error('Local game launch canceled')
        const config: GameLaunchConfig = {
          localUser: users[slot],
          blockedUsers: [],
          serverConfig: { serverUrl: '' },
          presentation: isHuman ? undefined : 'background',
          bwapiInstance: instance,
          setup: {
            gameId,
            name: 'Local practice',
            map: request.map,
            gameType,
            // For top vs bottom this is how many players are on top: just the human.
            gameSubType: teamGame ? 1 : 0,
            slots,
            host: slots[0],
            users,
            seed,
            useLegacyLimits: true,
            // Netcode v2 strips DTR's turn rate commands, so a dynamic rate would never move off
            // its low starting rate. Pin the rate every server-launched game uses.
            turnRate: 24,
            userLatency: BwUserLatency.Low,
            localSession: { endpoint, secret, slot, roster, initialBufferTurns: 1 },
          },
        }
        manager.setGameConfig(config)
      }
      session.timer = setTimeout(() => fail(new Error('Local game startup timed out')), 90000)
      return structuredClone(session.status)
    } catch (error) {
      if (session)
        await this.stopSession(session, error instanceof Error ? error : new Error(String(error)))
      throw error
    } finally {
      this.launching = false
    }
  }

  async stop(): Promise<void> {
    this.launchCanceled = true
    if (this.session) await this.stopSession(this.session)
  }

  /** Whether every bot instance in the session has reported a result or exited. */
  private allBotsFinished(session: Session): boolean {
    const bots = session.managers.filter(manager => manager !== this.playerManager)
    return (
      bots.length > 0 &&
      bots.every(manager => {
        const state = manager.getStatus()?.state
        return (
          state === undefined ||
          state === 'hasResult' ||
          state === 'resultSent' ||
          state === 'finished'
        )
      })
    )
  }

  private stopSession(session: Session, error?: Error): Promise<void> {
    if (session.stopped) return session.stopped
    if (error) {
      log.warning(`Local game session ${session.status.id} stopping: ${error.message}`)
    }
    const graceful = !error && session.status.state === 'playing'
    session.stopping = true
    clearTimeout(session.timer)
    session.status.state = 'stopping'
    session.status.error = error?.message
    this.publish(session)
    session.stopped = (async () => {
      if (graceful) {
        // A peer can apply the forwarded leave and publish its result before any client is asked
        // to leave. The deadline bounds games that cannot complete that transition.
        await this.waitForLocalResults(session)
        // Keep transport and bot workers alive while native game exit publishes BWAPI MatchEnd.
        // The deadline also releases control IPC if a client cannot complete its normal exit.
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            Promise.allSettled(session.managers.map(manager => manager.stop(true))),
            new Promise<void>(resolve => {
              timer = setTimeout(resolve, 2500)
            }),
          ])
        } finally {
          clearTimeout(timer)
        }
      }
      const waits = session.managers.map(manager => manager.stop())
      // Closing control IPC also cancels a game whose native thread is stalled.
      session.control?.dispose()
      session.hub?.close()
      for (const worker of session.workers) {
        waits.push(
          new Promise<void>(resolve => {
            if (worker.exitCode !== null || worker.signalCode !== null) resolve()
            else worker.once('exit', () => resolve())
          }),
        )
        if (worker.connected) worker.disconnect()
      }
      await Promise.allSettled(waits)
      for (const detach of session.detach) detach()
      session.status.state = error ? 'error' : 'finished'
      this.publish(session)
    })()
    return session.stopped
  }

  private publish(session: Session): void {
    this.emit('status', structuredClone(session.status))
  }

  private async verifyFiles(request: LocalGameRequest): Promise<void> {
    const { hash, mapData } = request.map
    const mapPath = this.mapStore.getPath(hash, mapData.format)
    const hasher = new HashThrough()
    hasher.hasher.update(mapData.format)
    hasher.resume()
    await pipeline(createReadStream(mapPath), hasher)
    if ((await hasher.hashPromise) !== hash)
      throw new Error('Downloaded map failed integrity check')
    for (const bot of request.bots) {
      if (!(await fs.stat(bot.executable)).isFile())
        throw new Error(`Bot executable missing: ${bot.name}`)
      if (!(await fs.stat(bot.workingDirectory)).isDirectory())
        throw new Error(`Bot profile missing: ${bot.name}`)
    }
  }

  private allManagersFinished(session: Session): boolean {
    return session.managers.every(manager => managerHasResultOrExited(manager))
  }

  private waitForLocalResults(session: Session): Promise<void> {
    if (this.allManagersFinished(session)) return Promise.resolve()
    return new Promise(resolve => {
      const deadline: ReturnType<typeof setTimeout> | undefined = setTimeout(
        () => finish(),
        LOCAL_RESULT_SETTLE_TIMEOUT,
      )
      const cleanup = () => {
        if (deadline) clearTimeout(deadline)
        for (const manager of session.managers) {
          manager.off('gameStatus', check)
          manager.off('gameExit', check)
        }
      }
      const finish = () => {
        cleanup()
        resolve()
      }
      const check = () => {
        if (this.allManagersFinished(session)) finish()
      }
      for (const manager of session.managers) {
        manager.on('gameStatus', check)
        manager.on('gameExit', check)
      }
      session.detach.push(finish)
      check()
    })
  }

  private waitForBotResult(session: Session, manager: ActiveGameManager): Promise<void> {
    if (managerHasResultOrExited(manager)) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const deadline: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        cleanup()
        reject(new Error('Bot exited before reporting a game result'))
      }, BOT_RESULT_TIMEOUT)
      const cleanup = () => {
        if (deadline) clearTimeout(deadline)
        manager.off('gameStatus', check)
        manager.off('gameExit', finish)
      }
      const finish = () => {
        cleanup()
        resolve()
      }
      const check = () => {
        if (managerHasResultOrExited(manager)) finish()
      }
      manager.on('gameStatus', check)
      manager.once('gameExit', finish)
      session.detach.push(finish)
      check()
    })
  }

  private startBot(
    session: Session,
    manager: ActiveGameManager,
    config: { executable: string; args: string[]; cwd: string; instance: string; logPath: string },
    fail: (error: Error) => void,
  ): Promise<void> {
    const worker = spawn(process.execPath, [path.join(__dirname, 'local-bot-worker.js')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    session.workers.push(worker)
    return new Promise((resolve, reject) => {
      let started = false
      let botExitReported = false
      const reportFailure = (error: Error) => {
        clearTimeout(startupTimer)
        if (!started) reject(error)
        if (!session.stopping) fail(error)
      }
      const startupTimer = setTimeout(
        () => reportFailure(new Error('Bot process launch timed out')),
        10000,
      )
      worker.on('message', message => {
        const event = message as { type: string; error?: string; code?: number | null }
        if (event.type === 'started') {
          if (!started) {
            started = true
            clearTimeout(startupTimer)
            resolve()
          }
          return
        }
        if (event.type === 'exit') {
          botExitReported = true
          if (!started) {
            reportFailure(new Error(`Bot process exited (${event.code})`))
          } else if (!session.stopping) {
            if (event.code !== 0) {
              reportFailure(new Error(`Bot process exited (${event.code})`))
            } else if (!managerHasResultOrExited(manager)) {
              const state = manager.getStatus()?.state
              if (state !== 'playing') {
                reportFailure(new Error('Bot exited before reporting a game result'))
              } else {
                this.waitForBotResult(session, manager).catch(error => {
                  if (!session.stopping) reportFailure(error)
                })
              }
            }
          }
          return
        }
        reportFailure(new Error(event.error ?? `Bot process exited (${event.code})`))
      })
      worker.on('error', error => reportFailure(error))
      worker.on('exit', () => {
        clearTimeout(startupTimer)
        if (!session.stopping && !botExitReported) {
          reportFailure(new Error('Bot process supervisor exited'))
        }
      })
      worker.send({ type: 'start', ...config })
    })
  }
}

function managerHasResultOrExited(manager: ActiveGameManager): boolean {
  const state = manager.getStatus()?.state
  return (
    state === undefined || state === 'hasResult' || state === 'resultSent' || state === 'finished'
  )
}

export function validateRequest(request: LocalGameRequest): void {
  if (!request || !request.map || !Array.isArray(request.bots)) {
    throw new Error('Choose one to seven bots')
  }
  // An observer takes no player slot, so every one of the eight can hold a bot; a watched game
  // needs two bots to have anything to watch.
  const observing = !!request.player?.observer
  const minBots = observing ? 2 : 1
  const maxBots = observing ? 8 : 7
  if (request.bots.length < minBots || request.bots.length > maxBots) {
    throw new Error(observing ? 'Choose two to eight bots to watch' : 'Choose one to seven bots')
  }
  const { mapData, hash } = request.map
  if (!/^[a-f0-9]{64}$/.test(hash) || !['scm', 'scx'].includes(mapData?.format)) {
    throw new Error('Invalid downloaded map')
  }
  if (
    mapData.slots < request.bots.length + (observing ? 0 : 1) ||
    mapData.width > 256 ||
    mapData.height > 256 ||
    mapData.isEud
  ) {
    throw new Error('Map does not support this local bot game')
  }
  if (
    request.gameType &&
    ![GameType.Melee, GameType.FreeForAll, GameType.TopVsBottom].includes(request.gameType)
  ) {
    throw new Error('Local bot games currently support melee and free-for-all')
  }
  for (const player of [request.player, ...request.bots]) {
    if (
      !player ||
      typeof player.name !== 'string' ||
      !/^[\x20-\x7e]{1,24}$/.test(player.name) ||
      !['p', 't', 'z', 'r'].includes(player.race)
    )
      throw new Error('Invalid local player name or race')
  }
  for (const bot of request.bots) {
    if (
      bot.replayName !== undefined &&
      (typeof bot.replayName !== 'string' || !/^[\x20-\x7e]{1,24}$/.test(bot.replayName))
    ) {
      throw new Error('Invalid local replay name')
    }
    if (
      !['p', 't', 'z'].includes(bot.race) ||
      !path.isAbsolute(bot.executable) ||
      !path.isAbsolute(bot.workingDirectory) ||
      !/\.exe$/i.test(bot.executable) ||
      (bot.args &&
        (!Array.isArray(bot.args) ||
          bot.args.some(arg => typeof arg !== 'string' || arg.includes('\0'))))
    ) {
      throw new Error('Select a bot executable, profile directory, and supported race')
    }
  }
}
