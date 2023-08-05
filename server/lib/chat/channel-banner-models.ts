import sql from 'sql-template-strings'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { ChannelBanner, ChannelBannerId } from '../../../common/chat-channels/channel-banners'
import db, { DbClient } from '../db'
import { Dbify } from '../db/types'
import { getUrl } from '../file-upload'
import { Patch } from '../http/patch-type'

type DbChannelBanner = Dbify<ChannelBanner>

function convertChannelBannerFromDb(props: DbChannelBanner): ChannelBanner {
  return {
    id: props.id,
    name: props.name,
    limited: props.limited,
    availableIn: props.available_in,
    imagePath: getUrl(props.image_path),
    uploadedAt: props.uploaded_at,
    updatedAt: props.updated_at,
  }
}

export async function adminGetChannelBanners(withClient?: DbClient): Promise<ChannelBanner[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbChannelBanner>(sql`
      SELECT *
      FROM channel_banners
      ORDER BY uploaded_at;
    `)
    return result.rows.map(convertChannelBannerFromDb)
  } finally {
    done()
  }
}

export async function adminGetChannelBanner(
  id: ChannelBannerId,
  withClient?: DbClient,
): Promise<ChannelBanner | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbChannelBanner>(sql`
      SELECT *
      FROM channel_banners
      WHERE id = ${id}
    `)

    return result.rows.length ? convertChannelBannerFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

export async function adminAddChannelBanner(
  { name, limited, availableIn, imagePath }: Omit<ChannelBanner, 'id' | 'uploadedAt' | 'updatedAt'>,
  withClient?: DbClient,
): Promise<ChannelBanner> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbChannelBanner>(sql`
      INSERT INTO channel_banners (
        name, limited, available_in, image_path, uploaded_at, updated_at
      ) VALUES (
        ${name}, ${limited}, ${availableIn}, ${imagePath}, ${new Date()}, ${new Date()}
      )
      RETURNING *;
    `)
    return convertChannelBannerFromDb(result.rows[0])
  } finally {
    done()
  }
}

export async function adminUpdateChannelBanner(
  id: ChannelBannerId,
  updates: Patch<Omit<ChannelBanner, 'id' | 'uploadedAt' | 'updatedAt'>>,
  withClient?: DbClient,
): Promise<ChannelBanner> {
  const { client, done } = await db(withClient)
  try {
    const query = sql`
      UPDATE channel_banners
      SET
    `

    let first = true
    for (const [_key, value] of Object.entries(updates)) {
      if (value === undefined) {
        continue
      }

      const key = _key as keyof typeof updates
      if (!first) {
        query.append(sql`, `)
      } else {
        first = false
      }

      switch (key) {
        case 'name':
          query.append(sql`name = ${value}`)
          break
        case 'limited':
          query.append(sql`limited = ${value}`)
          break
        case 'availableIn':
          query.append(sql`available_in = ${value}`)
          break
        case 'imagePath':
          query.append(sql`image_path = ${value}`)
          break

        default:
          assertUnreachable(key)
      }
    }

    if (first) {
      throw new Error('No columns updated')
    }

    query.append(sql`, updated_at = ${new Date()}`)
    query.append(sql`
      WHERE id = ${id}
      RETURNING *
    `)

    const result = await client.query<DbChannelBanner>(query)
    return convertChannelBannerFromDb(result.rows[0])
  } finally {
    done()
  }
}
