import redisStore from 'koa-redis'
import { container } from 'tsyringe'
import { Redis } from '../redis'

const redis = container.resolve(Redis)
export default redisStore({ client: redis })
