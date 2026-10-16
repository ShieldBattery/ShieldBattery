import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { apiUrl } from '../../common/urls'
import { clientId } from '../network/client-id'
import { fetchRaw } from '../network/fetch'

const ThumbnailImage = styled.img`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
`

/** Displays a replay's embedded map when no matching library image is available. */
export function ExtractedReplayMapImage({
  lobbyId,
  hash,
  mapName,
  queued = false,
}: {
  lobbyId: SbLobbyId
  hash: string
  mapName: string
  queued?: boolean
}) {
  const [imageUrl, setImageUrl] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    let url: string | undefined
    const query = new URLSearchParams({ clientId, ...(queued ? { hash } : {}) })
    fetchRaw(apiUrl`lobbies/${lobbyId}/replay-thumbnail` + `?${query}`, {
      signal: controller.signal,
      headers: { Accept: 'image/jpeg' },
    })
      .then(response => {
        if (!response.ok) throw new Error(`Replay map preview failed: ${response.status}`)
        return response.blob()
      })
      .then(blob => {
        if (!controller.signal.aborted) {
          url = URL.createObjectURL(blob)
          setImageUrl(url)
        }
      })
      .catch(() => {})

    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [lobbyId, hash, queued])

  return imageUrl ? <ThumbnailImage src={imageUrl} alt={mapName} /> : null
}
