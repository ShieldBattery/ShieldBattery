import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import {
  ALL_MODERATION_ACTION_KINDS,
  GetModerationActionsQuery,
  GetModerationActionsResponse,
  MODERATION_ACTIONS_PAGE_SIZE,
  ModerationAction,
  ModerationActionKind,
} from '../../../common/moderation-actions'
import { ALL_RESTRICTION_KINDS } from '../../../common/users/restrictions'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ALL_BAN_SOURCES } from '../../../common/users/user-network'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpGet } from '../http/route-decorators'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import { findUsersById } from '../users/user-model'
import { validateRequest } from '../validation/joi-validator'
import { getModerationActions, InvalidModerationCursorError } from './moderation-action-models'

const KIND_PATTERN = `(${ALL_MODERATION_ACTION_KINDS.join('|')})`
const KIND_LIST_PATTERN = new RegExp(`^${KIND_PATTERN}(,${KIND_PATTERN})*$`)

function referencedUsers(action: ModerationAction): Array<SbUserId | undefined> {
  switch (action.kind) {
    case ModerationActionKind.Ban:
      return [action.userId, action.bannedBy, action.cascadedFrom]
    case ModerationActionKind.Unban:
      return [action.userId, action.unbannedBy, action.cascadedFrom]
    case ModerationActionKind.Restriction:
      return [action.userId, action.restrictedBy, action.cascadedFrom]
    case ModerationActionKind.RestrictionLift:
      return [action.userId, action.liftedBy, action.cascadedFrom]
    case ModerationActionKind.MatchmakingBan:
      return [action.userId]
    default:
      return action satisfies never
  }
}

@httpApi('/admin/moderation-actions')
@httpBeforeAll(ensureLoggedIn, checkAllPermissions('banUsers'))
export class ModerationActionApi {
  @httpGet('/')
  async getActions(ctx: RouterContext): Promise<GetModerationActionsResponse> {
    const { query } = validateRequest(ctx, {
      query: Joi.object<GetModerationActionsQuery>({
        kinds: Joi.string().pattern(KIND_LIST_PATTERN),
        banSource: Joi.string().valid(...ALL_BAN_SOURCES),
        restrictionKind: Joi.string().valid(...ALL_RESTRICTION_KINDS),
        cursor: Joi.string().max(128),
      }),
    })

    const kinds = new Set(
      query.kinds !== undefined
        ? (query.kinds.split(',') as ModerationActionKind[])
        : ALL_MODERATION_ACTION_KINDS,
    )

    let result
    try {
      result = await getModerationActions({
        kinds,
        banSource: query.banSource,
        restrictionKind: query.restrictionKind,
        cursor: query.cursor,
        limit: MODERATION_ACTIONS_PAGE_SIZE,
      })
    } catch (err) {
      if (err instanceof InvalidModerationCursorError) throw new httpErrors.BadRequest(err.message)
      throw err
    }

    const userIds = new Set<SbUserId>()
    for (const action of result.actions) {
      for (const id of referencedUsers(action)) {
        if (id !== undefined) userIds.add(id)
      }
    }

    return {
      actions: result.actions,
      users: await findUsersById(Array.from(userIds)),
      nextCursor: result.nextCursor,
    }
  }
}
