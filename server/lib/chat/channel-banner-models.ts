import { assertUnreachable } from '../../../common/assert-unreachable'
import { ChannelBanner, ChannelBannerId } from '../../../common/chat-channels/channel-banners'
import { Patch } from '../../../common/patch'
import db, { DbClient } from '../db'
import { sql, sqlConcat } from '../db/sql'
import { Dbify } from '../db/types'
import { getUrl } from '../file-upload'

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
    let query = sql`
      UPDATE channel_banners
      SET
    `

    const updateEntries = Object.entries(updates).filter(([_, value]) => value !== undefined)
    if (!updateEntries.length) {
      throw new Error('No columns updated')
    }

    query = query.append(
      sqlConcat(
        ', ',
        updateEntries.map(([_key, value]) => {
          const key = _key as keyof typeof updates

          switch (key) {
            case 'name':
              return sql`name = ${value}`
            case 'limited':
              return sql`limited = ${value}`
            case 'availableIn':
              return sql`available_in = ${value}`
            case 'imagePath':
              return sql`image_path = ${value}`

            default:
              return assertUnreachable(key)
          }
        }),
      ),
    )

    query = query.append(sql`
      , updated_at = ${new Date()}
      WHERE id = ${id}
      RETURNING *
    `)

    const result = await client.query<DbChannelBanner>(query)
    return convertChannelBannerFromDb(result.rows[0])
  } finally {
    done()
  }
}
