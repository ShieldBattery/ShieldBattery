import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { apiUrl } from '../../../common/urls'
import { MapInfoImage } from '../../maps/map-image'
import { clientId } from '../../network/client-id'
import { fetchRaw } from '../../network/fetch'
import { useAppSelector } from '../../redux-hooks'
import { labelMedium } from '../../styles/typography'
import { ReplayCard, ReplayThumbnail } from '../lobby-replay'
import { replayDownloadProgressAtom } from '../replay-download-progress'

const Banner = styled.div`
  padding: 20px 24px;
  display: flex;
  align-items: center;
  gap: 24px;
  border-bottom: 1px solid var(--theme-outline-variant);
  background: linear-gradient(110deg, var(--theme-container-low), var(--theme-surface));
`

const ReplayDetails = styled.div`
  width: min(100%, 420px);
  flex-shrink: 0;
`

const ReplayArt = styled.div`
  position: relative;
  width: 160px;
  height: 160px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 8px;
`

const ThumbnailImage = styled.img`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
`

function ExtractedMapImage({
  lobbyId,
  hash,
  mapName,
}: {
  lobbyId: SbLobbyId
  hash: string
  mapName: string
}) {
  const [imageUrl, setImageUrl] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    let url: string | undefined
    fetchRaw(
      apiUrl`lobbies/${lobbyId}/replay-thumbnail` + `?${new URLSearchParams({ clientId })}`,
      {
        signal: controller.signal,
        headers: { Accept: 'image/jpeg' },
      },
    )
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
  }, [lobbyId, hash])

  return imageUrl ? <ThumbnailImage src={imageUrl} alt={mapName} /> : null
}

const LibraryImage = styled(MapInfoImage)`
  position: absolute;
  inset: 0;
`

const Eyebrow = styled.div`
  ${labelMedium};
  margin-bottom: 8px;
  color: var(--theme-amber);
`

const ProgressLabel = styled.div`
  ${labelMedium};
  margin-top: 12px;
  color: var(--theme-on-surface-variant);
`

const ProgressTrack = styled.div`
  height: 6px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--theme-container-high);
`

const ProgressFill = styled.div<{ $fraction: number }>`
  width: ${p => Math.round(p.$fraction * 100)}%;
  height: 100%;
  background: var(--theme-amber);
  transition: width 120ms ease-out;
`

/** Shows the replay being watched without treating it as a playable map. */
export function ReplayRoomBanner() {
  const { t } = useTranslation()
  const replay = useAppSelector(s => s.lobby.info.replay)
  const lobbyId = useAppSelector(s => s.lobby.info.id)
  const progress = useAtomValue(replayDownloadProgressAtom)
  if (!replay) {
    return null
  }
  const percent =
    progress && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100))
      : 0
  let progressLabel = t('lobbies.replayLobby.downloading', 'Downloading replay: {{percent}}%', {
    percent,
  })
  if (progress?.state === 'ready') {
    progressLabel = t('lobbies.replayLobby.downloadReady', 'Replay ready to watch')
  } else if (progress?.state === 'error') {
    progressLabel = t('lobbies.replayLobby.downloadFailed', 'Replay download failed')
  }

  return (
    <Banner>
      <ReplayArt>
        <ReplayThumbnail />
        {replay.source.metadata.mapImage?.image512Url ? (
          <LibraryImage map={replay.source.metadata.mapImage} size={512} />
        ) : (
          <ExtractedMapImage
            key={replay.hash}
            lobbyId={lobbyId}
            hash={replay.hash}
            mapName={replay.source.metadata.mapName}
          />
        )}
      </ReplayArt>
      <ReplayDetails>
        <Eyebrow>{t('lobbies.replayLobby.watchingTogetherHeader', 'Watching together')}</Eyebrow>
        <ReplayCard
          mapName={replay.source.metadata.mapName}
          durationFrames={replay.source.metadata.durationFrames}
          players={replay.source.metadata.players}
        />
        {progress?.lobbyId === lobbyId && progress.hash === replay.hash ? (
          <div role='progressbar' aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <ProgressLabel>{progressLabel}</ProgressLabel>
            <ProgressTrack>
              <ProgressFill
                $fraction={
                  progress.totalBytes > 0
                    ? Math.min(1, progress.loadedBytes / progress.totalBytes)
                    : 0
                }
              />
            </ProgressTrack>
          </div>
        ) : null}
      </ReplayDetails>
    </Banner>
  )
}
