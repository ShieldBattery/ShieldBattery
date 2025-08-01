import got from 'got'
import { inject, injectable } from 'tsyringe'
import logger from '../logging/logger'

export const DISCORD_WEBHOOK_URL_TOKEN = 'DISCORD_WEBHOOK_URL'

@injectable()
export class DiscordWebhookNotifier {
  constructor(@inject(DISCORD_WEBHOOK_URL_TOKEN) readonly webhookUrl: string) {}

  async notify({
    content,
    suppressEmbeds = true,
  }: {
    content: string
    suppressEmbeds?: boolean
  }): Promise<void> {
    if (!this.webhookUrl) {
      logger.info(`Discord webhook URL not set, skipping notification: \n\n${content}\n`)
      return
    }

    await got.post(this.webhookUrl, {
      json: {
        content: content.slice(0, 2000),
        // eslint-disable-next-line camelcase
        allowed_mentions: {
          parse: [],
        },
        flags: suppressEmbeds ? 4 : 0,
      },
      timeout: { request: 5000 },
    })
  }
}
