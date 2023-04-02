import React from 'react'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { Dialog } from '../material/dialog'
import { colorTextPrimary, colorTextSecondary } from '../styles/colors'
import { subtitle1, Subtitle1 } from '../styles/typography'
import { useTranslation } from 'react-i18next'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const List = styled.ul`
  padding-left: 16px;
`

const ListEntry = styled.li`
  & + & {
    margin-top: 24px;
  }

  color: ${colorTextSecondary};
`

const Emphasized = styled.b`
  ${subtitle1};

  display: block;
  margin-bottom: 4px;

  color: ${colorTextPrimary};
`

export function LeagueExplainerDialog({ dialogRef, onCancel }: CommonDialogProps) {
  const { t } = useTranslation()
  return (
    <StyledDialog
      title={t('leagues.explainer.howLeaguesWorkHeader', 'How leagues work')}
      onCancel={onCancel}
      showCloseButton={true}
      dialogRef={dialogRef}>
      <Subtitle1>
      {t('leagues.explainer.howLeaguesWorkText', 'Leagues are a new way to compete for prizes, qualify for tournament entries, and more!')}
      </Subtitle1>

      <List>
        <ListEntry>
          <Emphasized>{t('leagues.explainer.joinLabel', 'Join')}.</Emphasized>
          <div>
          {t('leagues.explainer.joinLeagueText', 'Find a league that is currently running or accepting signups in the format you\'d like to play. Some leagues may have different requirements, rules, or qualifications, so make sure to read the information before joining!')}
          </div>
        </ListEntry>
        <ListEntry>
          <Emphasized>{t('leagues.explainer.playLabel', 'Play')}.</Emphasized>
          <div>
          {t('leagues.explainer.playLeagueText', 'Once a league has started, all ladder games you play will reward points towards the league standings alongside your normal ladder standings. Check the leaderboard on the league page to see how you\'re doing!')}
          </div>
        </ListEntry>
        <ListEntry>
          <Emphasized>{t('leagues.explainer.winLabel', 'Win')}!</Emphasized>
          <div>
          {t('leagues.explainer.winLeagueText', 'After a league finishes, the leaderboard will be available for organizers to distribute prizes and rewards. Check out the league information page for more details.')}
          </div>
        </ListEntry>
      </List>
    </StyledDialog>
  )
}
