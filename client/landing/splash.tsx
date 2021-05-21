import { rgba } from 'polished'
import React, { ReactChild, ReactNode, useEffect, useState } from 'react'
import { connect, DispatchProp } from 'react-redux'
import styled, { css } from 'styled-components'
import { openDialog } from '../dialogs/action-creators'
import { ConnectedDialogOverlay } from '../dialogs/connected-dialog-overlay'
import { DialogType } from '../dialogs/dialog-type'
import DiscordIcon from '../icons/brands/discord-lockup.svg'
import GithubIcon from '../icons/brands/github.svg'
import PatreonIcon from '../icons/brands/patreon-lockup.svg'
import TwitterIcon from '../icons/brands/twitter.svg'
import LockOpenIcon from '../icons/material/lock_open_black_48px.svg'
import LogoText from '../logos/logotext-640x100.svg'
import { Label, RaisedButton } from '../material/button'
import Card from '../material/card'
import { linearOutSlowIn } from '../material/curve-constants'
import { push } from '../navigation/routing'
import { makeServerUrl } from '../network/server-url'
import { apiUrl } from '../network/urls'
import {
  amberA400,
  background700,
  background800,
  background900,
  blue800,
  colorTextPrimary,
  colorTextSecondary,
} from '../styles/colors'
import { headline3, headline4, headline5, subtitle1 } from '../styles/typography'
import ChatImage from './chat.svg'
import TacticallyFaithfulImage from './tactically-faithful.svg'
import TopLinks from './top-links'

const SplashContainer = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: ${background700};
  margin: 0px auto;
  padding-right: var(--pixel-shove-x, 0) !important;
  overflow: auto scroll;

  & * {
    user-select: text;
  }

  .electron & {
    /* move links below window controls */
    padding-top: 32px !important;

    &::after {
      position: absolute;
      height: 32px;
      top: 0;
      left: 0;
      right: 0;
      content: '';
      background-color: ${blue800};
      -webkit-app-region: drag;
    }
  }
`

const BackgroundVideo = styled.video`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  height: 860px;
  object-fit: cover;
`

const BackgroundVideoScrim = styled.div`
  position: absolute;
  width: 100%;
  top: 0;
  left: 0;
  /*
    This should be at least BackgroundVideo's height + blur distance, I added a bit extra to be
    safe
  */
  height: 880px;
  background: linear-gradient(
    to bottom,
    ${rgba(background700, 0.6)} 50%,
    ${rgba(background700, 1)} 96%
  );
`

const LogoLockup = styled.div`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  position: relative;
  margin: 20px 8px;
  pointer-events: none;
`

const Logo = styled.img`
  width: 128px;
  height: 128px;
  margin: 0 8px;
`

const StyledLogoText = styled(LogoText)`
  width: 320px;
  height: 50px;
  margin: 0 8px;
  margin-top: 6px; /* correct for baseline alignment */
`

const TagLine = styled.div`
  ${headline3};
  position: relative;
  margin: 16px 0px;
  padding: 0 16px;
  text-align: center;
`

const ButtonsContainer = styled.div`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
`

// TODO(tec27): Convert button stuff to TS instead of doing this hacky stuff here
interface RaisedButtonProps {
  label: ReactChild
  color?: 'primary' | 'accent'
  onClick?: (event: MouseEvent) => void
}

const SplashButton = styled(RaisedButton as unknown as React.ComponentType<RaisedButtonProps>)`
  width: 200px;
  height: 54px;
  margin: 16px 32px;

  & ${Label} {
    font-size: 20px;
    font-weight: 500;
    letter-spacing: 1.4px;
  }
`

const BenefitContainer = styled.div`
  width: 100%;
  max-width: 1024px;
  padding: 40px 16px;
  contain: content;

  display: grid;
  grid-column-gap: 40px;
  grid-row-gap: 64px;
  grid-template-columns: repeat(12, 1fr);
  align-items: center;

  @media screen and (max-width: 800px) {
    grid-template-columns: repeat(8, 1fr);
  }
`

const BenefitCard = styled(Card)`
  grid-column: auto / span 8;
  padding: 24px;
`

const benefitIconCss = css`
  width: 100%;
  height: auto;
  grid-column: auto / span 4;
  padding: 24px;
  margin: auto;

  @media screen and (max-width: 800px) {
    display: none;
  }
`

const StyledChatImage = styled(ChatImage)`
  ${benefitIconCss};
`

const StyledLockOpenIcon = styled(LockOpenIcon)`
  ${benefitIconCss};
  width: 80%; /* give this even visual weight with the other icons */
  color: ${amberA400};
`

const StyledTacticallyFaithfulImage = styled(TacticallyFaithfulImage)`
  ${benefitIconCss};
`

const BenefitTitle = styled.div`
  ${headline3};
`

const BenefitBody = styled.div`
  & > p {
    ${headline5};
    color: ${colorTextSecondary};
    font-weight: 300;
    margin: 20px 0 8px;
  }

  & > p + p {
    margin-top: 12px;
  }
`

interface BenefitSectionProps {
  title: string
  body: ReactNode[]
  image: ReactChild
  imageAtStart: boolean
}

const BenefitSection = ({ title, body, image, imageAtStart }: BenefitSectionProps) => {
  return (
    <React.Fragment>
      {imageAtStart ? image : null}
      <BenefitCard>
        <BenefitTitle>{title}</BenefitTitle>
        <BenefitBody>{body}</BenefitBody>
      </BenefitCard>
      {imageAtStart ? null : image}
    </React.Fragment>
  )
}

const FeatureContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding-top: 40px;
  padding-bottom: 40px;
  background-color: ${background800};
`

const FeatureSection = styled.div`
  width: 100%;
  max-width: 1000px;
  padding: 0 8px;

  & + & {
    margin-top: 80px;
  }
`

const FeatureSectionTitle = styled.div`
  ${headline4};
  margin-left: 16px;
`

const FeatureSectionList = styled.dl`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  column-gap: 32px;
  row-gap: 40px;
  padding-left: 16px;
  margin: 24px 0;

  @media screen and (max-width: 800px) {
    grid-template-columns: 1fr;
  }

  & dt {
    ${headline5};
    font-weight: 300;
  }

  & dd {
    ${headline5};
    color: ${colorTextSecondary};
    font-weight: 300;
    margin: 0;
  }
`

const ComingSoonText = styled.span`
  ${headline4};
  color: ${colorTextSecondary};
`

const BENEFITS: Readonly<Array<Omit<BenefitSectionProps, 'imageAtStart'>>> = [
  {
    title: 'Community first',
    body: [
      <p key='p1'>
        ShieldBattery is a vibrant hub for everyone who plays or watches StarCraft. Chat is front
        and center, getting into games is seamless and easy, and your experience is our top concern.
        Whether you've been playing since 1998 or just picked up the game this week, you'll find a
        home here.
      </p>,
    ],
    image: <StyledChatImage alt='' />,
  },
  {
    title: 'Tactically faithful',
    body: [
      <p key='p1'>
        Built by community members with collective decades of StarCraft experience, we know what
        makes the game tick. We're keeping the important things the same, but building out brand new
        features and improvements to make your StarCraft experience better than ever.
      </p>,
    ],
    image: <StyledTacticallyFaithfulImage alt='' />,
  },
  {
    title: 'Full potential unlocked',
    body: [
      <p key='p1'>
        StarCraft has an amazing competitive history, and ShieldBattery is a foundation for
        delivering the top-notch playing and watching experience it deserves. Open-source,
        community-driven, and set to deliver features and experiences that even modern games wish
        they could have: ShieldBattery is a revolutionary step forward for the StarCraft community.
      </p>,
    ],
    image: <StyledLockOpenIcon alt='' />,
  },
]

const FeatureEntryContainer = styled.div`
  grid-column: auto / span 1;
`

interface FeatureEntryProps {
  className?: string
  title: string
  description: string
}

function FeatureEntry({ className, title, description }: FeatureEntryProps) {
  return (
    <FeatureEntryContainer className={className}>
      <dt>{title}</dt>
      <dd>{description}</dd>
    </FeatureEntryContainer>
  )
}

const LinksSection = styled.div`
  width: 100%;
  max-width: 1000px;
  padding: 40px 24px;
  background-color: ${background700};
`

const LinksHeader = styled.div`
  ${headline4};
`

const LinkEntries = styled.div`
  display: flex;
  align-items: center;
  margin-top: 16px;
  /** Offset for the inner padding of the first item */
  margin-left: -16px;

  a,
  a:link,
  a:visited {
    height: 48px;
    display: flex;
    align-items: center;
    color: ${colorTextSecondary};
    padding-left: 16px;
    padding-right: 16px;
    overflow: hidden;

    &:hover,
    &:active {
      color: ${colorTextPrimary};
    }
  }
`

const DisclaimerSection = styled.div`
  width: 100%;
  background-color: ${background900};
`

const DisclaimerText = styled.div`
  ${subtitle1};
  width: 100%;
  max-width: 1000px;
  padding: 40px 24px;
  margin: 0 auto;
  color: ${colorTextSecondary};
`

const StyledDiscordIcon = styled(DiscordIcon)`
  height: 48px;
  margin-top: 4px;
`

const StyledGithubIcon = styled(GithubIcon)`
  height: 40px;
`

const StyledPatreonIcon = styled(PatreonIcon)`
  height: 24px;
`

const StyledTwitterIcon = styled(TwitterIcon)`
  height: 32px;
`

if ((window.CSS as any).registerProperty) {
  try {
    ;(window.CSS as any).registerProperty({
      name: '--sb-game-count',
      syntax: '<integer>',
      initialValue: 0,
      inherits: false,
    })
  } catch (err) {
    // We don't really care about errors here, the count just won't animate and that's fine. Often
    // this occurs just because of hot-reloading so it isn't even really an error
  }
}

const GameCountNumber = styled.span`
  transition: --sb-game-count 2s ${linearOutSlowIn};
  counter-reset: game-count var(--sb-game-count, 0);

  &::after {
    content: counter(game-count);
  }
`

function GameCount(props: { className?: string }) {
  const [gameCount, setGameCount] = useState(0)

  useEffect(() => {
    const eventSource = new EventSource(apiUrl`games`)

    eventSource.addEventListener('gameCount', event => {
      setGameCount((event as any).data)
    })

    return () => eventSource.close()
  }, [])

  return (
    <div className={props.className}>
      <GameCountNumber style={{ '--sb-game-count': gameCount } as any} /> games played
    </div>
  )
}

const StyledGameCount = styled(GameCount)`
  ${headline4};
  font-weight: 300;
  margin: 32px 0 16px;
  text-align: right;
  z-index: 1;
`

class Splash extends React.Component<DispatchProp> {
  render() {
    return (
      <React.Fragment>
        <SplashContainer>
          <BackgroundVideo playsInline={true} autoPlay={true} muted={true} loop={true}>
            <source src={makeServerUrl('/videos/splash-video.mp4')} type='video/mp4' />
          </BackgroundVideo>
          <BackgroundVideoScrim />
          <TopLinks />
          <LogoLockup>
            <Logo src={makeServerUrl('/images/logo.svg')} />
            <StyledLogoText />
          </LogoLockup>
          <TagLine>Play StarCraft 1 on the premier community-run platform</TagLine>
          {!IS_ELECTRON ? (
            <ButtonsContainer>
              <SplashButton label='Sign Up' color='primary' onClick={this.onSignUpClick} />
              <SplashButton label='Download' color='primary' onClick={this.onDownloadClick} />
            </ButtonsContainer>
          ) : (
            <SplashButton label='Sign Up' color='primary' onClick={this.onSignUpClick} />
          )}
          <StyledGameCount />
          <BenefitContainer>
            {BENEFITS.map((f, i) => (
              <BenefitSection
                title={f.title}
                body={f.body}
                image={f.image}
                imageAtStart={i % 2 !== 0}
                key={`feature-${i}`}
              />
            ))}
          </BenefitContainer>
          <FeatureContainer>
            <FeatureSection>
              <FeatureSectionTitle>Features</FeatureSectionTitle>
              <FeatureSectionList>
                <FeatureEntry
                  title='StarCraft: Remastered support'
                  description={
                    'Support for all the new Remastered features, including HD graphics (if ' +
                    'purchased from Blizzard) and custom hotkeys.'
                  }
                />
                <FeatureEntry
                  title='Cloud-based map distribution and hosting'
                  description={
                    'Play on any of the maps in our official library, or upload your own. Upload ' +
                    'all your favorite maps, share them with your friends, host them from anywhere.'
                  }
                />
                <FeatureEntry
                  title='1v1 Matchmaking'
                  description='Find matches quickly and easily.'
                />
                <FeatureEntry
                  title='Improved netcode'
                  description='Less lag, drops, and packet loss!'
                />
                <FeatureEntry
                  title='Web-based chat client'
                  description={
                    'Keep up with your friends (and enemies) without needing to install anything.'
                  }
                />
                <FeatureEntry
                  title='Working Team Melee replays'
                  description={'Play back any games played in Team Melee mode on ShieldBattery!'}
                />
              </FeatureSectionList>
            </FeatureSection>
            <FeatureSection>
              <FeatureSectionTitle>
                In the pipe <ComingSoonText>(coming soon)</ComingSoonText>
              </FeatureSectionTitle>
              <FeatureSectionList>
                <FeatureEntry
                  title='Ranked ladder'
                  description={
                    'Hone your skills in our Elo-based ranking system for all matchmaking modes.'
                  }
                />
                <FeatureEntry
                  title='Team matchmaking'
                  description='Easily find games for 2v2 and 3v3, with arranged or random teams.'
                />
                <FeatureEntry
                  title='Cloud-synced replays'
                  description={
                    'Automatic uploading for replays. Share them with others, watch them from ' +
                    'anywhere!'
                  }
                />
                <FeatureEntry
                  title='Configurable pixel scaling'
                  description={
                    'Improve the look of SD graphics on modern screens with custom scaling ' +
                    'algorithms.'
                  }
                />
                <FeatureEntry
                  title='Parties'
                  description={
                    'Party up with your friends to easily host private matches, watch replays ' +
                    'together, or join matchmaking.'
                  }
                />
                <FeatureEntry
                  title='Live match streaming'
                  description={
                    'Jump into in-progress matches and watch them live, with all the ' +
                    'benefits of ingame observing.'
                  }
                />
                <FeatureEntry
                  title='Player profiles and statistics'
                  description={
                    'Check out your skills across different matchups and maps, find ways to ' +
                    'improve, and see how you stack up against the competition.'
                  }
                />
                <FeatureEntry
                  title='Replay analysis'
                  description={
                    'Built-in support for BWChart-like replay analysis, as well as more advanced ' +
                    'statistics and charting.'
                  }
                />
                <FeatureEntry
                  title='First person replays'
                  description={
                    'Record mouse and screen movements and play them back for all players.'
                  }
                />
                <FeatureEntry
                  title='Training/sandbox mode'
                  description={
                    'Test out new builds, practice your worker split, improve your micro.'
                  }
                />
                <FeatureEntry
                  title='Friends list'
                  description={
                    'Track when your friends are online, easily send them messages and invite ' +
                    'them to games.'
                  }
                />
                <FeatureEntry
                  title='New built-in mapmaking features'
                  description={
                    'Destructible rocks, ideal worker starting positions, advanced creep ' +
                    ' placement, and more!'
                  }
                />
                <FeatureEntry
                  title='Automated tournaments and leagues'
                  description={
                    'Find tournaments and leagues that match your skill level, run automatically.'
                  }
                />
                <FeatureEntry
                  title='Expanded chat features'
                  description={
                    'Express yourself using emotes, embed maps, matches, and replays, and more!'
                  }
                />
                <FeatureEntry
                  title='Use Map Settings portal'
                  description={
                    'Find and explore UMS maps with ease, then quickly gather players and get ' +
                    'the game started.'
                  }
                />
              </FeatureSectionList>
            </FeatureSection>
          </FeatureContainer>
          <LinksSection>
            <LinksHeader>Links</LinksHeader>
            <LinkEntries>
              <a
                href='https://twitter.com/ShieldBatteryBW'
                title='Twitter'
                target='_blank'
                rel='noopener'>
                <StyledTwitterIcon />
              </a>
              <a
                href='https://github.com/ShieldBattery/ShieldBattery'
                title='GitHub'
                target='_blank'
                rel='noopener'>
                <StyledGithubIcon />
              </a>
              <a
                href='https://discord.gg/S8dfMx94a4'
                title='Discord'
                target='_blank'
                rel='noopener'>
                <StyledDiscordIcon />
              </a>
              <a href='https://patreon.com/tec27' title='Patreon' target='_blank' rel='noopener'>
                <StyledPatreonIcon />
              </a>
            </LinkEntries>
          </LinksSection>
          <DisclaimerSection>
            <DisclaimerText>
              StarCraft is a registered trademark of Blizzard Entertainment, Inc. ShieldBattery is
              developed solely by members of the community, unaffiliated with Blizzard, and is not
              officially endorsed or supported by Blizzard.
            </DisclaimerText>
          </DisclaimerSection>
        </SplashContainer>
        <ConnectedDialogOverlay />
      </React.Fragment>
    )
  }

  onSignUpClick = () => {
    push({ pathname: '/signup' })
  }

  onDownloadClick = () => {
    this.props.dispatch(openDialog(DialogType.Download))
  }
}

export default connect()(Splash)
