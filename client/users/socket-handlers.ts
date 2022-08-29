import type { NydusClient, RouteInfo } from 'nydus-client'
import { UserRelationshipEvent } from '../../common/users/relationships'
import { dispatch, Dispatchable } from '../dispatch-registry'

type EventToActionMap = {
  [E in UserRelationshipEvent['type']]?: (
    event: Extract<UserRelationshipEvent, { type: E }>,
  ) => Dispatchable | void | undefined
}

const eventToAction: EventToActionMap = {
  upsert: event => (dispatch, getState) => {
    const {
      auth: { user },
    } = getState()
    dispatch({
      type: '@users/upsertRelationship',
      payload: {
        relationship: event.relationship,
      },
      meta: { selfId: user.id },
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
}
