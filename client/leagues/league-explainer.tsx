import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { Dialog } from '../material/dialog'
import { BodyLarge, bodyLarge } from '../styles/typography'

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

  color: var(--theme-on-surface-variant);
`

const Emphasized = styled.b`
  ${bodyLarge};

  display: block;
  margin-bottom: 4px;

  color: var(--theme-on-surface);
`

export function LeagueExplainerDialog({ onCancel }: CommonDialogProps) {
  const { t } = useTranslation()

  return (
    <StyledDialog
      title={t('leagues.explainer.howLeaguesWork', 'How leagues work')}
      onCancel={onCancel}
      showCloseButton={true}>
      <BodyLarge>
        {t(
          'leagues.explainer.description',
          'Leagues are a new way to compete for prizes, qualify for tournament entries, and more!',
        )}
      </BodyLarge>

      <List>
        <ListEntry>
          <Emphasized>{t('leagues.explainer.joinTitle', 'Join.')}</Emphasized>
          <div>
            <Trans t={t} i18nKey='leagues.explainer.joinDescription'>
              Find a league that is currently running or accepting signups in the format you'd like
              to play. Some leagues may have different requirements, rules, or qualifications, so
              make sure to read the information before joining!
            </Trans>
          </div>
        </ListEntry>
        <ListEntry>
          <Emphasized>{t('leagues.explainer.playTitle', 'Play.')}</Emphasized>
          <div>
            <Trans t={t} i18nKey='leagues.explainer.playDescription'>
              Once a league has started, all ladder games you play will reward points towards the
              league standings alongside your normal ladder standings. Check the leaderboard on the
              league page to see how you're doing!
            </Trans>
          </div>
        </ListEntry>
        <ListEntry>
          <Emphasized>{t('leagues.explainer.winTitle', 'Win!')}</Emphasized>
          <div>
            <Trans t={t} i18nKey='leagues.explainer.winDescription'>
              After a league finishes, the leaderboard will be available for organizers to
              distribute prizes and rewards. Check out the league information page for more details.
            </Trans>
          </div>
        </ListEntry>
      </List>
    </StyledDialog>
  )
}
