import keycode from 'keycode'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Route, Switch } from 'wouter'
import ActivityBar from './activities/activity-bar'
import { ActivityButton } from './activities/activity-button'
import { VersionText } from './activities/version-text'
import { openDialog } from './dialogs/action-creators'
import { DialogType } from './dialogs/dialog-type'
import { GamesRouteComponent } from './games/route'
import { MaterialIcon } from './icons/material/material-icon'
import { navigateToLadder } from './ladder/action-creators'
import { LadderRouteComponent } from './ladder/ladder'
import { navigateToLeaguesList } from './leagues/action-creators'
import { LeagueRoot } from './leagues/league-list'
import { LoggedOutLeftNav } from './navigation/connected-left-nav'
import { useAppDispatch } from './redux-hooks'
import { FlexSpacer } from './styles/flex-spacer'
import { ProfileRouteComponent } from './users/route'

const ALT_D = { keyCode: keycode('d'), altKey: true }
const ALT_G = { keyCode: keycode('g'), altKey: true }
const ALT_O = { keyCode: keycode('o'), altKey: true }

const Container = styled.div`
  display: flex;
  overflow: hidden;
`

const Content = styled.div`
  flex-grow: 1;
  flex-shrink: 1;
  overflow-x: hidden;
`

export interface LoggedOutContentProps {
  /**
   * Content to render after anything that can be viewed while logged out. This will trigger a
   * redirect to the login page when the user hits those routes.
   */
  loggedInContent: React.ReactNode
}

/**
 * Top-level layout that encompasses content that can be viewed while logged out, but uses
 * MainLayout when logged in.
 */
export function LoggedOutContent({ loggedInContent }: LoggedOutContentProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  // TODO(tec27): Share more of the ActivityBar logic/styling with MainLayout
  return (
    <Container>
      <LoggedOutLeftNav />
      <Content>
        <Switch>
          <Route path='/games/:rest*' component={GamesRouteComponent} />
          <Route path='/ladder/:rest*' component={LadderRouteComponent} />
          <Route path='/leagues/:rest*' component={LeagueRoot} />
          <Route path='/users/:rest*' component={ProfileRouteComponent} />
          <Route>{loggedInContent}</Route>
        </Switch>
      </Content>
      <ActivityBar>
        <ActivityButton
          key='download'
          icon={<MaterialIcon icon='download' size={36} />}
          label={t('common.actions.download', 'Download')}
          onClick={() => dispatch(openDialog({ type: DialogType.Download }))}
          hotkey={ALT_O}
        />
        <ActivityButton
          key='ladder'
          icon={<MaterialIcon icon='military_tech' size={36} />}
          label={t('ladder.activity.title', 'Ladder')}
          onClick={() => navigateToLadder()}
          hotkey={ALT_D}
        />
        <ActivityButton
          key='leagues'
          icon={<MaterialIcon icon='social_leaderboard' size={36} />}
          label={t('leagues.activity.title', 'Leagues')}
          onClick={() => navigateToLeaguesList()}
          hotkey={ALT_G}
        />
        <FlexSpacer key='spacer' />
        <VersionText key='version' />
      </ActivityBar>
    </Container>
  )
}
