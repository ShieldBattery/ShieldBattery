import styled, { css, keyframes } from 'styled-components'
import { MaterialIcon } from '../../../icons/material/material-icon'
import { FilledButton, OutlinedButton, TextButton } from '../../../material/button'
import {
  labelLarge,
  labelMedium,
  labelSmall,
  singleLine,
  titleLarge,
} from '../../../styles/typography'
import {
  gameTypeChipLabel,
  getReadyCount,
  LobbyView,
  logAction,
  observerChipLabel,
} from './lobby-model'
import { SettingChip } from './lobby-parts'

const Root = styled.div`
  flex-shrink: 0;
  padding: 16px 20px 14px;

  display: flex;
  align-items: center;
  gap: 16px;

  border-bottom: 1px solid var(--theme-outline-variant);
`

const TitleBlock = styled.div`
  min-width: 0;
  flex-grow: 1;
`

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const Title = styled.h1`
  ${titleLarge};
  ${singleLine};

  flex-shrink: 0;
`

const VisibilityChip = styled.div`
  ${labelSmall};

  height: 24px;
  flex-shrink: 0;
  padding-inline: 8px;

  display: flex;
  align-items: center;
  gap: 4px;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  border-radius: 12px;
  color: var(--theme-on-surface-variant);
  letter-spacing: 0.08em;
  text-transform: uppercase;
`

const RegroupingChip = styled(VisibilityChip)`
  background-color: rgb(from var(--color-blue70) r g b / 0.22);
  color: var(--color-blue90);
`

const InviteButton = styled(TextButton)`
  flex-shrink: 0;
`

const Subline = styled.div`
  ${labelMedium};

  margin-top: 2px;

  color: var(--theme-on-surface-variant);
`

const Actions = styled.div`
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 8px;
`

const updatedFlash = keyframes`
  0%, 100% {
    background-color: rgb(from var(--theme-amber) r g b / 0.14);
  }
  50% {
    background-color: rgb(from var(--theme-amber) r g b / 0.34);
  }
`

const UpdatedChip = styled(SettingChip)`
  animation: ${updatedFlash} 1.6s ease-in-out infinite;
`

const SetupButton = styled(OutlinedButton)`
  flex-shrink: 0;
`

const NextMapCard = styled.div`
  flex-shrink: 0;
  padding: 8px 12px 8px 8px;

  display: flex;
  align-items: center;
  gap: 12px;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.06);
  border-radius: 8px;
`

const NextMapIcon = styled.div`
  width: 40px;
  height: 40px;

  display: flex;
  align-items: center;
  justify-content: center;

  background-color: rgb(from var(--color-blue70) r g b / 0.3);
  border-radius: 6px;
  color: var(--color-blue90);
`

const NextMapText = styled.div`
  min-width: 0;
`

const NextMapName = styled.div`
  ${labelLarge};
  ${singleLine};
`

const NextMapNote = styled.div`
  ${labelMedium};

  color: var(--theme-on-surface-variant);
`

const ChangeButton = styled(TextButton)`
  flex-shrink: 0;
  color: var(--theme-amber);
`

const readyButtonStyles = css`
  flex-shrink: 0;
  min-width: 132px;
`

const ReadyButton = styled(FilledButton)`
  ${readyButtonStyles};
`

const ReadyUpButton = styled(OutlinedButton)`
  ${readyButtonStyles};
`

/** The viewer's own ready state, and the room's progress toward everyone holding one. */
function ReadyControl({ view, onToggleReady }: { view: LobbyView; onToggleReady: () => void }) {
  if (view.viewer.isReady) {
    return (
      <ReadyButton
        label={`READY · ${getReadyCount(view)}/${view.participants.length}`}
        onClick={onToggleReady}
      />
    )
  }

  return (
    <ReadyUpButton
      label='READY UP'
      iconStart={<MaterialIcon icon='check' size={20} />}
      onClick={onToggleReady}
    />
  )
}

/**
 * The strip above the room: what this lobby is, how far into the evening it is, what it's set up to
 * play, and the two things the viewer can do about it — open the setup one level deeper, or say
 * they're ready.
 */
export function LobbyHeader({
  view,
  onToggleReady,
}: {
  view: LobbyView
  onToggleReady: () => void
}) {
  const { data, lobby, lifecycle, viewer } = view
  const regrouping = lifecycle === 'regroup'
  const canChangeSetup = viewer.isHost && (lifecycle === 'gathering' || regrouping)
  // A ready check only waits on people holding seats, so the bench doesn't get the toggle.
  const showReady = view.readyChecks && lifecycle === 'gathering' && !viewer.isBenched

  return (
    <Root>
      <TitleBlock>
        <TitleRow>
          <Title>{lobby.name}</Title>
          {regrouping ? (
            <RegroupingChip>Regrouping</RegroupingChip>
          ) : (
            <>
              <VisibilityChip>
                <MaterialIcon
                  icon={lobby.visibility === 'unlisted' ? 'link' : 'public'}
                  size={14}
                />
                {lobby.visibility === 'unlisted' ? 'Unlisted' : 'Public'}
              </VisibilityChip>
              <InviteButton
                label='COPY INVITE LINK'
                iconStart={<MaterialIcon icon='link' size={18} />}
                onClick={() => logAction('copyInviteLink', lobby.id)}
              />
            </>
          )}
        </TitleRow>
        <Subline>
          {regrouping
            ? `game ${data.gameNumber - 1} just ended · everyone's back`
            : `${view.peopleCount} people · game ${data.gameNumber} of tonight`}
        </Subline>
      </TitleBlock>

      {regrouping ? (
        <NextMapCard>
          <NextMapIcon>
            <MaterialIcon icon='map' />
          </NextMapIcon>
          <NextMapText>
            <NextMapName>Next: {lobby.map?.name}</NextMapName>
            <NextMapNote>same as last game</NextMapNote>
          </NextMapText>
          <ChangeButton label='CHANGE' onClick={() => logAction('changeNextMap')} />
        </NextMapCard>
      ) : (
        <Actions>
          <SettingChip>{gameTypeChipLabel(lobby)}</SettingChip>
          {data.updatedChip === 'turnRate' ? (
            <UpdatedChip $updated={true}>TR {data.turnRate} · UPDATED</UpdatedChip>
          ) : (
            <SettingChip>TR {data.turnRate}</SettingChip>
          )}
          <SettingChip $updated={data.updatedChip === 'observers'}>
            {observerChipLabel(lobby)}
          </SettingChip>
          {canChangeSetup ? (
            <SetupButton
              label='GAME SETUP'
              iconStart={<MaterialIcon icon='expand_more' size={20} />}
              onClick={() => logAction('openGameSetup')}
            />
          ) : null}
          {showReady ? <ReadyControl view={view} onToggleReady={onToggleReady} /> : null}
        </Actions>
      )}
    </Root>
  )
}
