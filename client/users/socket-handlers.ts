import type { NydusClient, RouteInfo } from 'nydus-client'
import {
  FriendActivityStatusUpdateEvent,
  UserRelationshipEvent,
} from '../../common/users/relationships.js'
import { Dispatchable, dispatch } from '../dispatch-registry.js'

type EventToActionMap = {
  [E in UserRelationshipEvent['type']]?: (
    event: Extract<UserRelationshipEvent, { type: E }>,
  ) => Dispatchable | void | undefined
}

const eventToAction: EventToActionMap = {
  upsert: event => (dispatch, getState) => {
    const {
      auth: { self },
    } = getState()
    dispatch({
      type: '@users/upsertRelationship',
      payload: {
        relationship: event.relationship,
      },
      meta: { selfId: self!.user.id },
    })
  },

  delete: event => ({
    type: '@users/deleteRelationship',
    payload: {
      targetUser: event.targetUser,
    },
  }),
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute(
    '/relationships/:userId',
    (route: RouteInfo, event: UserRelationshipEvent) => {
      const actionType = event.type as UserRelationshipEvent['type']
      if (!eventToAction[actionType]) return

      const action = eventToAction[actionType]!(event as any)
      if (action) dispatch(action)
    },
  )

  siteSocket.registerRoute(
    '/friends/status/:userId',
    (route: RouteInfo, event: FriendActivityStatusUpdateEvent) => {
      dispatch({
        type: '@users/updateFriendActivityStatus',
        payload: event,
      })
    },
  )
}
