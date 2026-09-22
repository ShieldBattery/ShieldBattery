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
import { makeSbUserId } from '../../common/users/sb-user-id'
import log from '../logger'
import { LocalSettingsManager, ScrSettingsManager } from '../settings'
import { ActiveGameManager } from './active-game-manager'
import { GameServer } from './game-server'
import { LocalGameHub } from './local-game-hub'
import { MapStore } from './map-store'

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
      const players = [request.player, ...request.bots]
      const users = players.map((player, slot) => ({
        id: makeSbUserId(slot + 1),
        name: player.name,
        created: 0,
      }))
      const slots: PlayerInfo[] = Array.from({ length: 8 }, (_, slot) => ({
        id: `local-${slot}`,
        userId: users[slot]?.id,
        race: players[slot]?.race ?? 'r',
        playerId: slot,
        teamId: 0,
        type: slot < players.length ? SlotType.Human : SlotType.Closed,
        typeId: 6,
      }))
      const roster = users.map((user, slot) => ({ slot, userId: user.id }))
      const seed = randomBytes(4).readUInt32LE()
      const logDirectory = path.join(app.getPath('userData'), 'logs', 'local-games', id)
      await fs.mkdir(logDirectory, { recursive: true })
      if (session.stopping) throw new Error('Local game launch canceled')

      for (let slot = 0; slot < players.length; slot++) {
        const gameId = slot === 0 ? playerGameId : botGameIds[slot - 1]
        const manager =
          slot === 0
            ? this.playerManager
            : new ActiveGameManager(this.mapStore, this.localSettings, this.scrSettings)
        manager.setLocalControlPipe(session.control.endpoint)
        session.managers.push(manager)
        session.detach.push(this.gameServer.registerManager(gameId, manager))
        const onExit = () => {
          if (session!.stopping) return
          this.stopSession(
            owned,
            slot === 0 ? undefined : new Error(`Bot client ${slot} exited`),
          ).catch(err => log.error(String(err)))
        }
        const onStatus = () => {
          const status = manager.getStatus()
          if (status?.state === 'error')
            fail(new Error(String(status.extra ?? 'Game launch failed')))
          if (slot === 0 && status?.state === 'playing' && !owned.stopping) {
            clearTimeout(owned.timer)
            owned.status.state = 'playing'
            this.publish(owned)
          }
        }
        manager.on('gameExit', onExit)
        manager.on('gameStatus', onStatus)
        session.detach.push(() => {
          manager.off('gameExit', onExit)
          manager.off('gameStatus', onStatus)
        })
        const instance = slot === 0 ? undefined : randomUUID()
        if (slot > 0) {
          const bot = request.bots[slot - 1]
          await this.startBot(
            session,
            {
              executable: bot.executable,
              args: bot.args ?? [],
              cwd: bot.workingDirectory,
              instance: instance!,
              logPath: path.join(logDirectory, `bot-${slot}.log`),
            },
            fail,
          )
        }
        if (session.stopping) throw new Error('Local game launch canceled')
        const config: GameLaunchConfig = {
          localUser: users[slot],
          blockedUsers: [],
          serverConfig: { serverUrl: '' },
          presentation: slot === 0 ? undefined : 'background',
          bwapiInstance: instance,
          setup: {
            gameId,
            name: 'Local practice',
            map: request.map,
            gameType: request.gameType ?? GameType.Melee,
            gameSubType: 0,
            slots,
            host: slots[0],
            users,
            seed,
            useLegacyLimits: true,
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

  private stopSession(session: Session, error?: Error): Promise<void> {
    if (session.stopped) return session.stopped
    session.stopping = true
    clearTimeout(session.timer)
    session.status.state = 'stopping'
    session.status.error = error?.message
    this.publish(session)
    session.stopped = (async () => {
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

  private startBot(
    session: Session,
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
      const timer = setTimeout(() => reject(new Error('Bot process launch timed out')), 10000)
      worker.on('message', message => {
        const event = message as { type: string; error?: string; code?: number }
        if (event.type === 'started') {
          clearTimeout(timer)
          resolve()
        } else if (!session.stopping) {
          const error = new Error(event.error ?? `Bot process exited (${event.code})`)
          clearTimeout(timer)
          reject(error)
          fail(error)
        }
      })
      worker.on('error', error => {
        clearTimeout(timer)
        reject(error)
        fail(error)
      })
      worker.on('exit', () => {
        clearTimeout(timer)
        if (!session.stopping) {
          const error = new Error('Bot process supervisor exited')
          reject(error)
          fail(error)
        }
      })
      worker.send({ type: 'start', ...config })
    })
  }
}

export function validateRequest(request: LocalGameRequest): void {
  if (
    !request ||
    !request.map ||
    !Array.isArray(request.bots) ||
    request.bots.length < 1 ||
    request.bots.length > 7
  )
    throw new Error('Choose one to seven bots')
  const { mapData, hash } = request.map
  if (!/^[a-f0-9]{64}$/.test(hash) || !['scm', 'scx'].includes(mapData?.format)) {
    throw new Error('Invalid downloaded map')
  }
  if (
    mapData.slots < request.bots.length + 1 ||
    mapData.width > 256 ||
    mapData.height > 256 ||
    mapData.isEud
  ) {
    throw new Error('Map does not support this local bot game')
  }
  if (request.gameType && ![GameType.Melee, GameType.FreeForAll].includes(request.gameType)) {
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
