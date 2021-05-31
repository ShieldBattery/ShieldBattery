import { NydusServer } from 'nydus'
import { injectable } from 'tsyringe'

// TODO(tec27): Might be possible to limit publishable events by path as well?

/**
 * A wrapper around a `NydusServer` that makes it easy to publish only specific types of events.
 */
@injectable()
export class TypedPublisher<T> {
  constructor(private nydus: NydusServer) {}

  /**
   * Publish a message to all clients subscribed to `path`.
   */
  publish<E extends T>(path: string, data?: E) {
    return this.nydus.publish(path, data)
  }
}
