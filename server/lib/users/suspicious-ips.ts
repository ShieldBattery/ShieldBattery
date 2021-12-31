import { singleton } from 'tsyringe'
import { UserIpInfo } from '../../../common/users/sb-user'
import { Redis } from '../redis'

// Don't mark IPs as suspicious for longer than we'd track them in the DB (60 days)
const MAX_SUSPICIOUS_TIME_SECONDS = 60 * 24 * 60 * 60

function suspiciousKey(ipAddress: string): string {
  return `sb-suspicious-ip:${ipAddress}`
}

/**
 * Manages a list of "supicious" IPs: addresses that were used by users that are now banned. These
 * addresses can still create accounts, but only via the standalone client, so it is effectively
 * a soft IP ban.
 */
@singleton()
export class SuspiciousIpsService {
  constructor(private redis: Redis) {}

  async markSuspicious(ips: ReadonlyArray<UserIpInfo>, suspiciousUntil: Date): Promise<void> {
    const untilSeconds = Math.min(
      (Number(suspiciousUntil) - Date.now()) / 1000,
      MAX_SUSPICIOUS_TIME_SECONDS,
    )
    const pipeline = this.redis.pipeline()
    for (const ip of ips) {
      // TODO(tec27): Should probably check the current expiry time and bump it up if this one is
      // higher
      pipeline.set(suspiciousKey(ip.ipAddress), 's', 'EX', untilSeconds, 'NX')
    }

    await pipeline.exec()
  }

  async isIpSuspicious(ip: string): Promise<boolean> {
    const res = await this.redis.exists(suspiciousKey(ip))
    return res === 1
  }
}
