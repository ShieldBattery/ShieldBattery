import keycode from 'keycode'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { styled } from 'styled-components'
import { Route, Switch } from 'wouter'
import ActivityBar from './activities/activity-bar.js'
import { ActivityButton } from './activities/activity-button.js'
import { VersionText } from './activities/version-text.js'
import { openDialog } from './dialogs/action-creators.js'
import { DialogType } from './dialogs/dialog-type.js'
import { GamesRouteComponent } from './games/route.js'
import { MaterialIcon } from './icons/material/material-icon.js'
import { navigateToLadder } from './ladder/action-creators.js'
import { LadderRouteComponent } from './ladder/ladder.js'
import { navigateToLeaguesList } from './leagues/action-creators.js'
import { LeagueRoot } from './leagues/league-list.js'
import { LoggedOutLeftNav } from './navigation/connected-left-nav.js'
import { useAppDispatch } from './redux-hooks.js'
import { FlexSpacer } from './styles/flex-spacer.js'
import { ProfileRouteComponent } from './users/route.js'

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
          <Route path='/games/*?' component={GamesRouteComponent} />
          <Route path='/ladder/*?' component={LadderRouteComponent} />
          <Route path='/leagues/*?' component={LeagueRoot} />
          <Route path='/users/*?' component={ProfileRouteComponent} />
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
