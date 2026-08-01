import * as React from 'react'
import { Route } from 'wouter'
import { useIsAdmin } from './admin/admin-permissions'
import { ForgotPassword } from './auth/forgot-password'
import { Login } from './auth/login'
import { RecoverUsername } from './auth/recover-username'
import { ResetPassword } from './auth/reset-password'
import { OnlyInApp } from './download/only-in-app'
import { Home } from './home/home'
import { MainLayoutLoadingDotsArea } from './main-layout'
import { AnimatedSwitch } from './navigation/animated-switch'
import { StaticNewsRedirect } from './news/static-news-redirect'
import { TwitchOAuthCallback } from './twitch/twitch-oauth-callback'

const AdminPanel = React.lazy(() => import('./admin/panel'))
const LobbyView = React.lazy(async () => ({
  default: (await import('./lobbies/view')).LobbyView,
}))
const LobbyLandingPage = React.lazy(async () => ({
  default: (await import('./lobbies/lobby-landing')).LobbyLandingPage,
}))
const Signup = React.lazy(async () => ({
  default: (await import('./auth/signup')).Signup,
}))
const Faq = React.lazy(async () => ({
  default: (await import('./home/faq')).Faq,
}))
const DownloadPage = React.lazy(async () => ({
  default: (await import('./download/download-page')).DownloadPage,
}))
const AcceptableUsePage = React.lazy(async () => ({
  default: (await import('./policies/policy-displays')).AcceptableUsePage,
}))
const PrivacyPolicyPage = React.lazy(async () => ({
  default: (await import('./policies/policy-displays')).PrivacyPolicyPage,
}))
const TermsOfServicePage = React.lazy(async () => ({
  default: (await import('./policies/policy-displays')).TermsOfServicePage,
}))
const ChannelRouteComponent = React.lazy(async () => ({
  default: (await import('./chat/chat-routes')).ChannelRouteComponent,
}))
const GamesRouteComponent = React.lazy(async () => ({
  default: (await import('./games/route')).GamesRouteComponent,
}))
const LadderRouteComponent = React.lazy(async () => ({
  default: (await import('./ladder/ladder')).LadderRouteComponent,
}))
const LeagueRoot = React.lazy(async () => ({
  default: (await import('./leagues/league-routes')).LeagueRoot,
}))
const LiveStreamsPage = React.lazy(async () => ({
  default: (await import('./twitch/live-streams-page')).LiveStreamsPage,
}))
const MapsRoot = React.lazy(async () => ({
  default: (await import('./maps/maps-root')).MapsRoot,
}))
const NewsArchivePage = React.lazy(async () => ({
  default: (await import('./news/news-archive-page')).NewsArchivePage,
}))
const NewsPostPage = React.lazy(async () => ({
  default: (await import('./news/news-post-page')).NewsPostPage,
}))
const PlayRoot = React.lazy(async () => ({
  default: (await import('./gameplay-activity/play-root')).PlayRoot,
}))
const ReplaysRoot = React.lazy(async () => ({
  default: (await import('./replays/replays-root')).ReplaysRoot,
}))
const ProfileRouteComponent = React.lazy(async () => ({
  default: (await import('./users/route')).ProfileRouteComponent,
}))
const WhisperRouteComponent = React.lazy(async () => ({
  default: (await import('./whispers/route')).WhisperRouteComponent,
}))

export function AppRoutes({
  container,
}: {
  container: React.ReactElement<{ children: React.ReactNode }>
}) {
  const isAdmin = useIsAdmin()

  return (
    <AnimatedSwitch container={container} fallback={<MainLayoutLoadingDotsArea />}>
      <Route path='/faq' component={Faq} />
      <Route path='/download' component={DownloadPage} />
      <Route path='/acceptable-use' component={AcceptableUsePage} />
      <Route path='/privacy' component={PrivacyPolicyPage} />
      <Route path='/terms-of-service' component={TermsOfServicePage} />

      <Route path='/forgot-password' component={ForgotPassword} />
      <Route path='/recover-username' component={RecoverUsername} />
      <Route path='/login' component={Login} />
      <Route path='/reset-password' component={ResetPassword} />
      <Route path='/signup' component={IS_ELECTRON ? Signup : OnlyInApp} />
      <Route
        path='/signup-i-know-im-not-in-the-app-but-i-really-want-to-anyway'
        component={Signup}
      />

      <Route path='/twitch/callback' component={TwitchOAuthCallback} />

      {isAdmin ? <Route path='/admin/*?' component={AdminPanel} /> : <></>}

      <Route path='/chat/*?' component={ChannelRouteComponent} />
      <Route path='/games/*?' component={GamesRouteComponent} />
      <Route path='/ladder/*?' component={LadderRouteComponent} />
      <Route path='/leagues/*?' component={LeagueRoot} />
      <Route path='/live' component={LiveStreamsPage} />
      <Route path='/lobbies/:lobbyId/*?' component={IS_ELECTRON ? LobbyView : LobbyLandingPage} />
      <Route path='/maps/*?' component={MapsRoot} />
      <Route path='/news/:id/*?' component={NewsPostPage} />
      <Route path='/news' component={NewsArchivePage} />
      <Route path='/play/*?' component={PlayRoot} />
      <Route path='/replays/*?' component={ReplaysRoot} />
      <Route path='/static-news/:id' component={StaticNewsRedirect} />
      <Route path='/users/*?' component={ProfileRouteComponent} />
      <Route path='/whispers/*?' component={WhisperRouteComponent} />
      <Route component={Home} />
    </AnimatedSwitch>
  )
}
