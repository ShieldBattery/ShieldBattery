import { singleton } from 'tsyringe'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import {
  LobbyBestOfJson,
  LobbyBestOfLogoJson,
  LobbyBestOfOverlayJson,
} from '../../../common/lobbies/lobby-best-of'
import { LobbyServiceErrorCode } from '../../../common/lobbies/lobby-network'
import { SbUserId } from '../../../common/users/sb-user-id'
import { deleteFile, getUrl, writeFile } from '../files'
import { createImagePath } from '../files/images'
import { ImageService } from '../images/image-service'
import logger from '../logging/logger'
import { rasterizeBestOfLogo } from './best-of-logo'
import {
  getRememberedBestOfOverlay,
  RememberedBestOfOverlay,
  setRememberedBestOfOverlay,
  StoredBestOfLogo,
} from './lobby-best-of-overlay-models'
import {
  LobbyService,
  LobbyServiceError,
  StartBestOfParams,
  UpdateBestOfParams,
} from './lobby-service'

/** The file store folder best-of series logos are kept in. */
const LOGO_FOLDER = 'best-of-logos'
/** The longest uploaded file name kept for showing a logo's origin. */
const MAX_LOGO_FILE_NAME_LENGTH = 255

/** A logo file a host uploaded, as the multipart parser left it. */
export interface UploadedBestOfLogo {
  filepath: string
  originalFilename?: string | null
}

/** How a start or save treats the series' logo. */
export type BestOfLogoChange =
  /** Starting: the host's remembered logo. Saving: the series' logo as it is. */
  { kind: 'keep' } | { kind: 'replace'; file: UploadedBestOfLogo } | { kind: 'remove' }

function toLogoJson(logo: StoredBestOfLogo): LobbyBestOfLogoJson {
  return { url: getUrl(logo.path), fileName: logo.fileName }
}

function toOverlayResponse(remembered: RememberedBestOfOverlay | undefined) {
  const overlay: LobbyBestOfOverlayJson = {}
  if (remembered?.line1) overlay.line1 = remembered.line1
  if (remembered?.line2) overlay.line2 = remembered.line2
  if (remembered?.logo) overlay.logo = toLogoJson(remembered.logo)
  return overlay
}

function toFileName(file: UploadedBestOfLogo): string {
  const name = (file.originalFilename ?? '').split(/[\\/]/).at(-1)!.trim()
  return name.slice(0, MAX_LOGO_FILE_NAME_LENGTH) || 'logo'
}

/**
 * Starts and saves best-of series together with their caster overlay's logo and the overlay a host
 * is remembered by.
 *
 * Every host has at most one stored logo, which belongs to their row of remembered values: it is
 * written before that row points at it, and deleted once the row no longer does. Every series that
 * shows a logo shows one some host's row points at, so when a row moves off a logo, every series
 * showing it is moved to the row's new logo (or to none) before the file is deleted.
 *
 * A host's starts and saves run one at a time, so two of them can't both read the same remembered
 * logo and each replace it.
 */
@singleton()
export class LobbyBestOfOverlayService {
  /** The latest start or save for each host, which their next one waits for. */
  private readonly hostOperations = new Map<SbUserId, Promise<unknown>>()

  constructor(
    private lobbyService: LobbyService,
    private imageService: ImageService,
  ) {}

  /** Returns the caster overlay a user's next best-of series starts with. */
  async getRemembered(userId: SbUserId): Promise<LobbyBestOfOverlayJson> {
    return toOverlayResponse(await getRememberedBestOfOverlay(userId))
  }

  /**
   * Starts a best-of series with a caster overlay, and remembers its lines and logo as the ones
   * the host's next series starts with.
   */
  startBestOf(
    params: Omit<StartBestOfParams, 'logo'>,
    logoChange: BestOfLogoChange,
  ): Promise<LobbyBestOfJson> {
    return this.sequence(params.client.userId, () =>
      this.apply({
        userId: params.client.userId,
        logoChange,
        check: () => this.lobbyService.checkStartBestOf(params),
        commit: rememberedLogo =>
          this.lobbyService.startBestOf({ ...params, logo: rememberedLogo }),
      }),
    )
  }

  /**
   * Changes a running best-of series, and remembers the lines and logo it has afterwards as the ones
   * the host's next series starts with.
   */
  updateBestOf(
    params: Omit<UpdateBestOfParams, 'logo'>,
    logoChange: BestOfLogoChange,
  ): Promise<LobbyBestOfJson> {
    return this.sequence(params.client.userId, () =>
      this.apply({
        userId: params.client.userId,
        logoChange,
        // Whether the logo is replaced or removed makes no difference to whether the change is
        // valid, only to what it changes
        check: () =>
          this.lobbyService.checkUpdateBestOf({
            ...params,
            logo: logoChange.kind === 'keep' ? undefined : null,
          }),
        commit: rememberedLogo =>
          this.lobbyService.updateBestOf({
            ...params,
            logo: logoChange.kind === 'keep' ? undefined : (rememberedLogo ?? null),
          }),
      }),
    )
  }

  /**
   * Runs a start or save:
   *
   * 1. `check` refuses anything the lobby would refuse, before an upload is looked at.
   * 2. An uploaded logo is drawn as a PNG, checked for safety and stored under a path of its own.
   * 3. The host's remembered values are updated to what the series will have.
   * 4. `commit` applies the change to the lobby, which checks everything again, since the lobby may
   *    have changed while 2 and 3 waited. If it refuses now, 3 is undone and the new file deleted.
   * 5. A remembered logo the host moved off of is taken off every series and its file deleted.
   *
   * A refusal at any step leaves the series and the remembered values as they were, and nothing
   * stored.
   */
  private async apply({
    userId,
    logoChange,
    check,
    commit,
  }: {
    userId: SbUserId
    logoChange: BestOfLogoChange
    check: () => void
    /** Applies the change to the lobby, given the logo the host's remembered values now hold. */
    commit: (rememberedLogo: LobbyBestOfLogoJson | undefined) => LobbyBestOfJson
  }): Promise<LobbyBestOfJson> {
    check()

    let newLogo: StoredBestOfLogo | undefined
    if (logoChange.kind === 'replace') {
      newLogo = await this.storeLogo(logoChange.file)
    }

    let previous: RememberedBestOfOverlay | undefined
    let remembered: RememberedBestOfOverlay
    try {
      previous = await getRememberedBestOfOverlay(userId)
      // The logo is written before the commit, so the row points at a new file before anything
      // shows it; the lines are only known once the lobby has applied the change, so they are
      // written after it. `newLogo` is set only when the logo is replaced, so this also covers
      // removing it.
      remembered = { ...previous, logo: logoChange.kind === 'keep' ? previous?.logo : newLogo }
      await setRememberedBestOfOverlay(userId, remembered)
    } catch (err) {
      if (newLogo) {
        this.deleteLogoFile(newLogo.path)
      }
      throw err
    }

    let bestOf: LobbyBestOfJson
    try {
      bestOf = commit(remembered.logo ? toLogoJson(remembered.logo) : undefined)
    } catch (err) {
      await this.restore(userId, previous, newLogo)
      throw err
    }

    if (previous?.logo && previous.logo.path !== remembered.logo?.path) {
      this.lobbyService.replaceBestOfLogo(
        getUrl(previous.logo.path),
        remembered.logo ? toLogoJson(remembered.logo) : undefined,
      )
      this.deleteLogoFile(previous.logo.path)
    }

    await this.rememberLines(userId, bestOf, remembered)

    return bestOf
  }

  /**
   * Remembers the lines a series has after a start or save. The change has already reached the
   * lobby by now, so a failure here is logged rather than refusing a change that took effect; the
   * host's next series then starts with the lines remembered before.
   */
  private async rememberLines(
    userId: SbUserId,
    bestOf: LobbyBestOfJson,
    remembered: RememberedBestOfOverlay,
  ) {
    try {
      await setRememberedBestOfOverlay(userId, {
        line1: bestOf.overlay?.line1,
        line2: bestOf.overlay?.line2,
        logo: remembered.logo,
      })
    } catch (err) {
      logger.error({ err }, "error remembering a best-of series' caster overlay lines")
    }
  }

  /**
   * Puts a host's remembered values back after the lobby refused a change they were updated for,
   * and deletes the logo stored for it. Should putting them back fail, the row may still point at
   * the new logo, so that file is kept.
   */
  private async restore(
    userId: SbUserId,
    previous: RememberedBestOfOverlay | undefined,
    newLogo: StoredBestOfLogo | undefined,
  ) {
    try {
      await setRememberedBestOfOverlay(userId, previous ?? {})
    } catch (err) {
      logger.error({ err }, "error restoring a host's remembered best-of overlay")
      return
    }
    if (newLogo) {
      this.deleteLogoFile(newLogo.path)
    }
  }

  /**
   * Draws an uploaded logo as a PNG, checks it for safety and stores it, returning where. Throws
   * before anything is stored if the logo is refused.
   */
  private async storeLogo(file: UploadedBestOfLogo): Promise<StoredBestOfLogo> {
    const png = await rasterizeBestOfLogo(file.filepath)
    if (!(await this.imageService.isImageSafe(png))) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.BestOfLogoInappropriate,
        'the logo is inappropriate',
      )
    }
    const path = createImagePath(LOGO_FOLDER, 'png')
    await writeFile(path, png, { acl: 'public-read', type: 'image/png' })
    return { path, fileName: toFileName(file) }
  }

  private deleteLogoFile(path: string) {
    deleteFile(path).catch(err => logger.error({ err }, 'error deleting a best-of series logo'))
  }

  /** Runs `operation` once every earlier start or save by the same host has settled. */
  private sequence<T>(userId: SbUserId, operation: () => Promise<T>): Promise<T> {
    const previous = this.hostOperations.get(userId) ?? Promise.resolve()
    const result = previous.then(operation)
    const settled = result.then(
      () => {},
      () => {},
    )
    this.hostOperations.set(userId, settled)
    settled
      .finally(() => {
        if (this.hostOperations.get(userId) === settled) {
          this.hostOperations.delete(userId)
        }
      })
      .catch(swallowNonBuiltins)
    return result
  }
}
