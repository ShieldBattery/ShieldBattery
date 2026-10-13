import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useAppSelector } from '../../redux-hooks'
import { bodyMedium, labelMedium } from '../../styles/typography'
import { ReplayCard } from '../lobby-replay'

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

const Description = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const Eyebrow = styled.div`
  ${labelMedium};
  margin-bottom: 8px;
  color: var(--theme-amber);
`

/** Shows the replay being watched without treating it as a playable map. */
export function ReplayRoomBanner() {
  const { t } = useTranslation()
  const replay = useAppSelector(s => s.lobby.info.replay)
  if (!replay) {
    return null
  }

  return (
    <Banner>
      <ReplayDetails>
        <Eyebrow>{t('lobbies.replayLobby.watchingTogetherHeader', 'Watching together')}</Eyebrow>
        <ReplayCard
          mapName={replay.source.metadata.mapName}
          durationFrames={replay.source.metadata.durationFrames}
          players={replay.source.metadata.players}
        />
      </ReplayDetails>
      <Description>
        {t(
          'lobbies.replayLobby.roomDescription',
          'Everyone watches the same replay with their own observer view. Playback starts when every viewer has loaded it.',
        )}
      </Description>
    </Banner>
  )
}
