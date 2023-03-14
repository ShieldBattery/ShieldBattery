import { RouterContext } from '@koa/router'
import cuid from 'cuid'
import formidable from 'formidable'
import httpErrors from 'http-errors'
import Joi from 'joi'
import sharp from 'sharp'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  AdminAddLeagueResponse,
  AdminEditLeagueResponse,
  AdminGetLeagueResponse,
  AdminGetLeaguesResponse,
  ClientLeagueId,
  fromClientLeagueId,
  GetLeagueByIdResponse,
  GetLeagueLeaderboardResponse,
  GetLeaguesListResponse,
  JoinLeagueResponse,
  League,
  LeagueErrorCode,
  LeagueId,
  LEAGUE_IMAGE_HEIGHT,
  LEAGUE_IMAGE_WIDTH,
  ServerAdminAddLeagueRequest,
  ServerAdminEditLeagueRequest,
  toClientLeagueId,
  toClientLeagueUserJson,
  toLeagueJson,
} from '../../../common/leagues'
import { ALL_MATCHMAKING_TYPES } from '../../../common/matchmaking'
import { UNIQUE_VIOLATION } from '../db/pg-error-codes'
import transact from '../db/transaction'
import { CodedError, makeErrorConverterMiddleware } from '../errors/coded-error'
import { asHttpError } from '../errors/error-with-payload'
import { writeFile } from '../file-upload'
import { handleMultipartFiles } from '../file-upload/handle-multipart-files'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpGet, httpPatch, httpPost } from '../http/route-decorators'
import { checkAllPermissions } from '../permissions/check-permissions'
import { Redis } from '../redis'
import ensureLoggedIn from '../session/ensure-logged-in'
import { findUsersById } from '../users/user-model'
import { joiPrettyId } from '../validation/joi-pretty-id'
import { validateRequest } from '../validation/joi-validator'
import { getLeaderboard } from './leaderboard'
import {
  adminGetAllLeagues,
  adminGetLeague,
  createLeague,
  getAllLeaguesForUser,
  getCurrentLeagues,
  getFutureLeagues,
  getLeague,
  getLeagueUser,
  getManyLeagueUsers,
  getPastLeagues,
  joinLeagueForUser,
  LeagueUser,
  Patch,
  updateLeague,
} from './league-models'

const MAX_IMAGE_SIZE = 5 * 1024 * 1024

class LeagueApiError extends CodedError<LeagueErrorCode> {}

const convertLeagueApiErrors = makeErrorConverterMiddleware(err => {
  if (!(err instanceof LeagueApiError)) {
    throw err
  }

  switch (err.code) {
    case LeagueErrorCode.NotFound:
      throw asHttpError(404, err)
    case LeagueErrorCode.AlreadyEnded:
      throw asHttpError(410, err)

    default:
      assertUnreachable(err.code)
  }
})

function leagueIdFromUrl(ctx: RouterContext): LeagueId {
  const { params } = validateRequest(ctx, {
    params: Joi.object<{ clientLeagueId: ClientLeagueId }>({
      clientLeagueId: joiPrettyId().required(),
    }),
  })

  try {
    return fromClientLeagueId(params.clientLeagueId)
  } catch (err) {
    throw new httpErrors.BadRequest('invalid league id')
  }
}

@httpApi('/leagues/')
@httpBeforeAll(convertLeagueApiErrors)
export class LeagueApi {
  constructor(private redis: Redis) {}

  @httpGet('/')
  async getLeagues(ctx: RouterContext): Promise<GetLeaguesListResponse> {
    const now = new Date()
    const isLoggedIn = !!ctx.session?.userId
    const [past, current, future, selfLeagues] = await Promise.all([
      getPastLeagues(now),
      getCurrentLeagues(now),
      getFutureLeagues(now),
      isLoggedIn ? getAllLeaguesForUser(ctx.session!.userId) : [],
    ])
    return {
      past: past.map(l => toLeagueJson(l)),
      current: current.map(l => toLeagueJson(l)),
      future: future.map(l => toLeagueJson(l)),
      selfLeagues: selfLeagues.map(lu =>
        toClientLeagueUserJson({ ...lu, leagueId: toClientLeagueId(lu.leagueId) }),
      ),
    }
  }

  @httpGet('/:clientLeagueId')
  async getLeagueById(ctx: RouterContext): Promise<GetLeagueByIdResponse> {
    const leagueId = leagueIdFromUrl(ctx)
    const now = new Date()
    const league = await getLeague(leagueId, now)

    if (!league) {
      throw new LeagueApiError(LeagueErrorCode.NotFound, 'league not found')
    }

    let selfLeagueUser: LeagueUser | undefined
    if (ctx.session?.userId) {
      selfLeagueUser = await getLeagueUser(leagueId, ctx.session.userId)
    }

    const leagueJson = toLeagueJson(league)

    return {
      league: leagueJson,
      selfLeagueUser: selfLeagueUser
        ? toClientLeagueUserJson({ ...selfLeagueUser, leagueId: leagueJson.id })
        : undefined,
    }
  }

  @httpGet('/:clientLeagueId/leaderboard')
  async getLeaderboard(ctx: RouterContext): Promise<GetLeagueLeaderboardResponse> {
    const leagueId = leagueIdFromUrl(ctx)
    const now = new Date()
    const [league, leaderboard] = await Promise.all([
      getLeague(leagueId, now),
      getLeaderboard(this.redis, leagueId),
    ])

    if (!league) {
      throw new LeagueApiError(LeagueErrorCode.NotFound, 'league not found')
    }

    const leagueJson = toLeagueJson(league)

    const [users, leagueUsers] = await Promise.all([
      leaderboard.length > 0 ? findUsersById(leaderboard) : [],
      leaderboard.length > 0 ? getManyLeagueUsers(leagueId, leaderboard) : [],
    ])

    return {
      league: leagueJson,
      leaderboard,
      leagueUsers: leagueUsers.map(lu =>
        toClientLeagueUserJson({ ...lu, leagueId: leagueJson.id }),
      ),
      users,
    }
  }

  @httpPost('/:clientLeagueId/join')
  @httpBefore(ensureLoggedIn)
  async joinLeague(ctx: RouterContext): Promise<JoinLeagueResponse> {
    const leagueId = leagueIdFromUrl(ctx)
    const now = new Date()
    const league = await getLeague(leagueId, now)

    if (!league) {
      throw new LeagueApiError(LeagueErrorCode.NotFound, 'league not found')
    } else if (league.endAt <= now) {
      throw new LeagueApiError(LeagueErrorCode.AlreadyEnded, 'league already ended')
    }

    let selfLeagueUser: LeagueUser | undefined
    try {
      selfLeagueUser = await joinLeagueForUser(leagueId, ctx.session!.userId)
    } catch (err: any) {
      if (err.code === UNIQUE_VIOLATION) {
        selfLeagueUser = await getLeagueUser(leagueId, ctx.session!.userId)
      }
    }

    if (!selfLeagueUser) {
      // This should never really happen, so we don't use an error code for it
      throw new Error('League was joined but no LeagueUser was returned')
    }

    const leagueJson = toLeagueJson(league)
    return {
      league: leagueJson,
      selfLeagueUser: toClientLeagueUserJson({ ...selfLeagueUser, leagueId: leagueJson.id }),
    }
  }
}

@httpApi('/admin/leagues/')
@httpBeforeAll(ensureLoggedIn, checkAllPermissions('manageLeagues'))
export class LeagueAdminApi {
  @httpGet('/')
  async getLeagues(ctx: RouterContext): Promise<AdminGetLeaguesResponse> {
    const leagues = await adminGetAllLeagues()
    return { leagues: leagues.map(l => toLeagueJson(l)) }
  }

  @httpGet('/:clientLeagueId')
  async getLeague(ctx: RouterContext): Promise<AdminGetLeagueResponse> {
    const leagueId = leagueIdFromUrl(ctx)
    const league = await adminGetLeague(leagueId)

    if (!league) {
      throw new LeagueApiError(LeagueErrorCode.NotFound, 'league not found')
    }

    return { league: toLeagueJson(league) }
  }

  private async handleImage(
    file: formidable.File,
  ): Promise<[image: sharp.Sharp, imageExtension: string]> {
    const image = sharp(file.filepath)
    const metadata = await image.metadata()

    let imageExtension: string
    if (metadata.format !== 'jpg' && metadata.format !== 'jpeg' && metadata.format !== 'png') {
      image.toFormat('png')
      imageExtension = 'png'
    } else {
      imageExtension = metadata.format
    }

    image.resize(LEAGUE_IMAGE_WIDTH, LEAGUE_IMAGE_HEIGHT, {
      fit: sharp.fit.cover,
      withoutEnlargement: true,
    })

    return [image, imageExtension]
  }

  @httpPost('/')
  @httpBefore(handleMultipartFiles(MAX_IMAGE_SIZE))
  async addLeague(ctx: RouterContext): Promise<AdminAddLeagueResponse> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<ServerAdminAddLeagueRequest & { image: any }>({
        name: Joi.string().required(),
        matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
        description: Joi.string().required(),
        signupsAfter: Joi.date().timestamp().min(Date.now()).required(),
        startAt: Joi.date().timestamp().min(Date.now()).required(),
        endAt: Joi.date().timestamp().min(Date.now()).required(),
        rulesAndInfo: Joi.string(),
        link: Joi.string().uri({ scheme: ['http', 'https'] }),
        image: Joi.any(),
      }),
    })

    if (body.signupsAfter > body.startAt) {
      throw new httpErrors.BadRequest('signupsAfter must be before startAt')
    } else if (body.startAt > body.endAt) {
      throw new httpErrors.BadRequest('startAt must be before endAt')
    }

    const file = ctx.request.files?.image
    if (file && Array.isArray(file)) {
      throw new httpErrors.BadRequest('only one image file can be uploaded')
    }
    const [image, imageExtension] = file ? await this.handleImage(file) : [undefined, undefined]

    return await transact(async client => {
      let imagePath: string | undefined
      if (image) {
        const imageId = cuid()
        // Note that cuid ID's are less random at the start so we use the end instead
        const firstChars = imageId.slice(-4, -2)
        const secondChars = imageId.slice(-2)
        imagePath = `league-images/${firstChars}/${secondChars}/${imageId}.${imageExtension}`
      }

      const league = await createLeague(
        {
          ...body,
          imagePath,
        },
        client,
      )

      if (image && imagePath) {
        const buffer = await image.toBuffer()
        writeFile(imagePath, buffer)
      }

      return {
        league: toLeagueJson(league),
      }
    })
  }

  @httpPatch('/:clientLeagueId')
  @httpBefore(handleMultipartFiles(MAX_IMAGE_SIZE))
  async editLeague(ctx: RouterContext): Promise<AdminEditLeagueResponse> {
    const leagueId = leagueIdFromUrl(ctx)
    const originalLeague = await adminGetLeague(leagueId)

    if (!originalLeague) {
      throw new LeagueApiError(LeagueErrorCode.NotFound, 'league not found')
    }

    const { body } = validateRequest(ctx, {
      body: Joi.object<ServerAdminEditLeagueRequest & { image: any }>({
        name: Joi.string(),
        matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES),
        description: Joi.string(),
        signupsAfter: Joi.date().timestamp(),
        startAt: Joi.date().timestamp(),
        endAt: Joi.date().timestamp(),
        rulesAndInfo: Joi.string().allow(null),
        link: Joi.string().allow(null),
        image: Joi.any(),
        deleteImage: Joi.boolean(),
      }),
    })

    const now = new Date()

    if (body.signupsAfter && originalLeague.signupsAfter <= now) {
      throw new httpErrors.BadRequest('cannot change signupsAfter once signups have started')
    } else if (body.signupsAfter && body.signupsAfter <= now) {
      throw new httpErrors.BadRequest('cannot change signupsAfter to a time in the past')
    }

    if (body.startAt && originalLeague.startAt <= now) {
      throw new httpErrors.BadRequest('cannot change startAt once the league has started')
    } else if (body.startAt && body.startAt <= now) {
      throw new httpErrors.BadRequest('cannot change startAt to a time in the past')
    }

    if (body.endAt && originalLeague.endAt <= now) {
      throw new httpErrors.BadRequest('cannot change endAt once the league has ended')
    } else if (body.endAt && body.endAt <= now) {
      throw new httpErrors.BadRequest('cannot change endAt to a time in the past')
    }

    const file = ctx.request.files?.image
    if (file && Array.isArray(file)) {
      throw new httpErrors.BadRequest('only one image file can be uploaded')
    }
    const [image, imageExtension] =
      !body.deleteImage && file ? await this.handleImage(file) : [undefined, undefined]

    return await transact(async client => {
      let imagePath: string | undefined
      if (image) {
        // TODO(tec27): We should probably delete the old image as well
        const imageId = cuid()
        // Note that cuid ID's are less random at the start so we use the end instead
        const firstChars = imageId.slice(-4, -2)
        const secondChars = imageId.slice(-2)
        imagePath = `league-images/${firstChars}/${secondChars}/${imageId}.${imageExtension}`
      }

      const updatedLeague: Patch<Omit<League, 'id'>> = {
        ...body,
      }
      delete (updatedLeague as any).image
      delete (updatedLeague as any).deleteImage

      if (body.deleteImage) {
        updatedLeague.imagePath = null
      } else if (imagePath) {
        updatedLeague.imagePath = imagePath
      }

      const league = await updateLeague(leagueId, updatedLeague, client)

      if (image && imagePath) {
        const buffer = await image.toBuffer()
        writeFile(imagePath, buffer)
      }

      return {
        league: toLeagueJson(league),
      }
    })
  }
}
