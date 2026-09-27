import { singleton } from 'tsyringe'
import { CommendEvent } from '../../../common/games/commends'
import { urlPath } from '../../../common/urls'
import { SbUserId } from '../../../common/users/sb-user-id'
import logger from '../logging/logger'
import { RedisSubscriber } from '../redis/redis'
import { UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'

export function getCommendsPath(userId: SbUserId): string {
  return urlPath`/commends/${userId}`
}

/**
 * Relays commends (written by server-rs, which publishes them to Redis) to the commended player's
 * connected clients. Deliberately never touches `NotificationService`: the client shows commends as
 * local notifications, so nothing about them is stored, and a player who is offline when commended
 * never hears about it.
 *
 * This has no HTTP API of its own, so it's eagerly constructed in `routes.ts` to make sure the Redis
 * subscription is set up at boot.
 */
@singleton()
export class GameCommendNotificationService {
  constructor(
    private redisSubscriber: RedisSubscriber,
    private userSockets: UserSocketsManager,
    private publisher: TypedPublisher<CommendEvent>,
  ) {
    this.userSockets.on('newUser', user => {
      user.subscribe(getCommendsPath(user.userId))
    })

    this.redisSubscriber
      .subscribe('gameCommend', message => {
        switch (message.type) {
          case 'commendReceived':
            this.publisher.publish(getCommendsPath(message.data.commendedUserId), {
              type: 'commendReceived',
              gameId: message.data.gameId,
              commenderId: message.data.commenderId,
            })
            break
          default:
            // Checks the discriminant rather than the message: TypeScript doesn't narrow a
            // single-variant union to `never` in a default branch.
            message.type satisfies never
            logger.warn(`received an unknown gameCommend message type: ${(message as any).type}`)
        }
      })
      .catch(err => {
        logger.error({ err }, 'failed to subscribe to Redis gameCommend messages')
      })
  }
}
