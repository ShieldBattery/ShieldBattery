import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { LobbyVisibility } from '../../../common/lobbies'
import { MaterialIcon } from '../../icons/material/material-icon'
import { FilterChip } from '../../material/filter-chip'
import { bodySmall } from '../../styles/typography'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const Row = styled.div`
  display: flex;
  gap: 8px;
`

const Description = styled.div`
  ${bodySmall};
  min-height: 16px;
  color: var(--theme-on-surface-variant);
`

export interface VisibilityPickerProps {
  value: LobbyVisibility
  onChange: (value: LobbyVisibility) => void
  disabled?: boolean
}

/** A chip row for picking whether a lobby is published to the public list or not, plus a one-line description of whichever option is currently selected. */
export function VisibilityPicker({ value, onChange, disabled }: VisibilityPickerProps) {
  const { t } = useTranslation()

  const description =
    value === 'listed'
      ? t(
          'lobbies.hostGame.visibilityListedDescription',
          'Anyone can join from the lobby list. Games and replays are public.',
        )
      : t(
          'lobbies.hostGame.visibilityUnlistedDescription',
          'Only people with the link can join. Only people that were in the game can download the replay.',
        )

  return (
    <Root>
      <Row>
        <FilterChip
          label={t('lobbies.createLobby.visibilityListed', 'Public')}
          icon={<MaterialIcon icon='public' size={18} />}
          selected={value === 'listed'}
          checkmark={false}
          disabled={disabled}
          onClick={() => onChange('listed')}
        />
        <FilterChip
          label={t('lobbies.createLobby.visibilityUnlisted', 'Unlisted')}
          icon={<MaterialIcon icon='visibility_off' size={18} />}
          selected={value === 'unlisted'}
          checkmark={false}
          disabled={disabled}
          onClick={() => onChange('unlisted')}
        />
      </Row>
      <Description>{description}</Description>
    </Root>
  )
}
