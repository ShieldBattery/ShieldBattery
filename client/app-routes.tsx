import React from 'react'
import { Route, Switch } from 'wouter'
import { useIsAdmin } from './admin/admin-permissions'
import { EmailVerificationUi } from './auth/email-verification'
import { ForgotPassword, ForgotUser, ResetPassword } from './auth/forgot'
import { Login } from './auth/login'
import { ChannelRouteComponent } from './chat/chat-routes'
import { DownloadPage } from './download/download-page'
import { OnlyInApp } from './download/only-in-app'
import { PlayRoot } from './gameplay-activity/play-root'
import { GamesRouteComponent } from './games/route'
import { Faq } from './home/faq'
import { Home } from './home/home'
import { LadderRouteComponent } from './ladder/ladder'
import { LeagueRoot } from './leagues/league-routes'
import { MapsRoot } from './maps/maps-root'
import { StaticNewsRoute } from './news/static-news-details'
import {
  AcceptableUsePage,
  PrivacyPolicyPage,
  TermsOfServicePage,
} from './policies/policy-displays'
import DotsIndicator from './progress/dots'
import { ReplaysRoot } from './replays/replays-root'
import { ProfileRouteComponent } from './users/route'
import { WhisperRouteComponent } from './whispers/route'

const AdminPanelComponent = React.lazy(() => import('./admin/panel'))
const LobbyView = React.lazy(async () => ({
  default: (await import('./lobbies/view')).LobbyView,
}))
const MatchmakingView = React.lazy(() => import('./matchmaking/view'))
const Signup = React.lazy(async () => ({
  default: (await import('./auth/signup')).Signup,
}))

function LoadableAdminPanel() {
  // TODO(tec27): do we need to position this indicator differently? (or pull that into a common
  // place?)
  return (
    <React.Suspense fallback={<DotsIndicator />}>
      <AdminPanelComponent />
    </React.Suspense>
  )
}

export function AppRoutes() {
  const isAdmin = useIsAdmin()
  return (
    <Switch>
      <Route path='/faq' component={Faq} />
      <Route path='/download' component={DownloadPage} />
      <Route path='/acceptable-use' component={AcceptableUsePage} />
      <Route path='/privacy' component={PrivacyPolicyPage} />
      <Route path='/terms-of-service' component={TermsOfServicePage} />
      <Route path='/forgot-password' component={ForgotPassword} />
      <Route path='/forgot-user' component={ForgotUser} />
      <Route path='/login' component={Login} />
      <Route path='/reset-password' component={ResetPassword} />
      <Route path='/signup' component={IS_ELECTRON ? Signup : OnlyInApp} />
      <Route
        path='/signup-i-know-im-not-in-the-app-but-i-really-want-to-anyway'
        component={Signup}
      />
      <Route path='/verify-email' component={EmailVerificationUi} />
      {isAdmin ? <Route path='/admin/*?' component={LoadableAdminPanel} /> : <></>}
      <Route path='/chat/*?' component={ChannelRouteComponent} />
      <Route path='/games/*?' component={GamesRouteComponent} />
      <Route path='/ladder/*?' component={LadderRouteComponent} />
      <Route path='/leagues/*?' component={LeagueRoot} />
      {IS_ELECTRON ? <Route path='/lobbies/:lobby/*?' component={LobbyView} /> : <></>}
      <Route path='/maps/*?' component={MapsRoot} />
      {IS_ELECTRON ? <Route path='/matchmaking/*?' component={MatchmakingView} /> : <></>}
      <Route path='/play/*?' component={PlayRoot} />
      <Route path='/replays/*?' component={ReplaysRoot} />
      <Route path='/static-news/*?' component={StaticNewsRoute} />
      <Route path='/users/*?' component={ProfileRouteComponent} />
      <Route path='/whispers/*?' component={WhisperRouteComponent} />
      <Route component={Home} />
    </Switch>
  )
}
