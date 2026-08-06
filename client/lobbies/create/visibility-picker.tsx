import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { LobbyVisibility } from '../../../common/lobbies'
import { MaterialIcon } from '../../icons/material/material-icon'
import { buttonReset } from '../../material/button-reset'
import { bodySmall, labelLarge } from '../../styles/typography'

const Row = styled.div`
  display: flex;
  gap: 8px;
  max-width: 640px;
`

const Card = styled.button<{ $selected: boolean }>`
  ${buttonReset};

  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 12px 14px;
  text-align: left;

  border: 1px solid
    ${props => (props.$selected ? 'var(--theme-amber)' : 'var(--theme-outline-variant)')};
  border-radius: 8px;
  background-color: ${props =>
    props.$selected ? 'rgb(from var(--theme-amber) r g b / 0.12)' : 'transparent'};

  &:hover {
    background-color: ${props =>
      props.$selected
        ? 'rgb(from var(--theme-amber) r g b / 0.18)'
        : 'rgb(from var(--theme-on-surface) r g b / 0.08)'};
  }

  &:disabled {
    cursor: default;
    opacity: var(--theme-disabled-opacity);
    pointer-events: none;
  }
`

const CardIcon = styled(MaterialIcon)`
  color: var(--theme-on-surface-variant);
`

const CardTitle = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface);
`

const CardDescription = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

export interface VisibilityPickerProps {
  value: LobbyVisibility
  onChange: (value: LobbyVisibility) => void
  disabled?: boolean
}

/** Two side-by-side cards for picking whether a lobby is published to the public list or not. */
export function VisibilityPicker({ value, onChange, disabled }: VisibilityPickerProps) {
  const { t } = useTranslation()

  return (
    <Row>
      <Card
        type='button'
        disabled={disabled}
        aria-pressed={value === 'listed'}
        $selected={value === 'listed'}
        onClick={() => onChange('listed')}>
        <CardIcon icon='public' />
        <CardTitle>{t('lobbies.createLobby.visibilityListed', 'Public')}</CardTitle>
        <CardDescription>
          {t(
            'lobbies.hostGame.visibilityListedDescription',
            'Anyone can join from the lobby list. Games and replays are public.',
          )}
        </CardDescription>
      </Card>
      <Card
        type='button'
        disabled={disabled}
        aria-pressed={value === 'unlisted'}
        $selected={value === 'unlisted'}
        onClick={() => onChange('unlisted')}>
        <CardIcon icon='visibility_off' />
        <CardTitle>{t('lobbies.createLobby.visibilityUnlisted', 'Unlisted')}</CardTitle>
        <CardDescription>
          {t(
            'lobbies.hostGame.visibilityUnlistedDescription',
            'Only people with the link can join. Games and replays are unlisted.',
          )}
        </CardDescription>
      </Card>
    </Row>
  )
}
