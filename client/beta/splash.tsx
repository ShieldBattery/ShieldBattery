import { push } from 'connected-react-router'
import { rgba } from 'polished'
import React, { ReactChild, ReactNode } from 'react'
import { connect, DispatchProp } from 'react-redux'
import styled from 'styled-components'
import { openDialog } from '../dialogs/action-creators'
import ConnectedDialogOverlay from '../dialogs/connected-dialog-overlay'
import LogoText from '../logos/logotext-640x100.svg'
import { Label } from '../material/button'
import Card from '../material/card'
import RaisedButton from '../material/raised-button'
import { makeServerUrl } from '../network/server-url'
import { colorTextSecondary, grey850, grey900 } from '../styles/colors'
import { headline3, headline4, headline5 } from '../styles/typography'
import ChatImage from './chat.svg'
import TopLinks from './top-links'

const SplashContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  height: auto !important;
  background-color: ${grey850};
  margin: 0px auto;
  overflow: auto;

  & * {
    user-select: text;
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
  filter: blur(8px);
`

const BackgroundVideoScrim = styled.div`
  position: absolute;
  width: 100%;
  /*
    This should be at least BackgroundVideo's height + blur distance, I added a bit extra to be
    safe
  */
  height: 880px;
  background: linear-gradient(to bottom, ${rgba(grey850, 0.6)} 50%, ${rgba(grey850, 1)} 96%);
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

// TODO(2Pac): Use proper typography css for this from some common place
const TagLine = styled.div`
  position: relative;
  font-family: Roboto Condensed, sans-serif;
  font-size: 34px;
  font-weight: 700;
  line-height: 40px;
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

const SplashButton = styled((RaisedButton as unknown) as React.ComponentType<RaisedButtonProps>)`
  width: 200px;
  height: 54px;
  margin: 16px 32px;

  & ${Label} {
    font-size: 20px;
    font-weight: 400;
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

const StyledChatImage = styled(ChatImage)`
  width: 100%;
  height: auto;
  grid-column: auto / span 4;
  padding: 24px;

  @media screen and (max-width: 800px) {
    display: none;
  }
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
  background-color: ${grey900};
`

const FeatureSection = styled.div`
  width: 100%;
  max-width: 1000px;
  padding: 0 16px 64px 16px;
`

const FeatureSectionTitle = styled.div`
  ${headline4};
  margin-left: 16px;
`

interface FeatureSectionListProps {
  columnCount?: string
  columnGap?: string
}

const FeatureSectionList = styled.ul<FeatureSectionListProps>`
  padding-left: 32px;
  column-count: ${props => props.columnCount ?? 'auto'};
  column-gap: ${props => props.columnGap ?? 'normal'};

  & > li {
    font-size: 20px;
    font-weight: 300;
    line-height: 40px;
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
    image: <StyledChatImage alt='' />,
  },
  {
    title: 'Realizing untapped potential',
    body: [
      <p key='p1'>
        StarCraft has an amazing competitive history, and ShieldBattery is a foundation for
        delivering the top-notch playing and watching experience it deserves. Open-source,
        community-driven, and set to deliver features and experiences that even modern games wish
        they could have: ShieldBattery is a revolutionary step for the StarCraft community.
      </p>,
    ],
    image: <StyledChatImage alt='' />,
  },
]

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
          <TagLine>Play StarCraft: Brood War on the premier community-run platform</TagLine>
          {!IS_ELECTRON ? (
            <ButtonsContainer>
              <SplashButton label='Sign Up' color='primary' onClick={this.onSignUpClick} />
              <SplashButton label='Download' color='primary' onClick={this.onDownloadClick} />
            </ButtonsContainer>
          ) : (
            <SplashButton label='Sign Up' color='primary' onClick={this.onSignUpClick} />
          )}
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
                <li>Innovative new network stack</li>
                <li>
                  Support for fullscreen, borderless, and normal windowed mode with resolution
                  scaling
                </li>
                <li>Windows 7 and 10 support</li>
                <li>Observer mode, with up to 6 observers per game</li>
                <li>Lobby join alerts</li>
                <li>Web-based client for chat and community features</li>
                <li>Server-based map distribution and hosting</li>
                <li>Automatic replay saving</li>
              </FeatureSectionList>
            </FeatureSection>
            <FeatureSection>
              <FeatureSectionTitle>
                In the pipe <ComingSoonText>(coming soon)</ComingSoonText>
              </FeatureSectionTitle>
              <FeatureSectionList columnCount='2' columnGap='24px'>
                <li>Matchmaking</li>
                <li>Ranked ladder</li>
                <li>Custom map uploading</li>
                <li>Cloud-synced replays</li>
                <li>Configurable pixel scaling</li>
                <li>Live match streaming</li>
                <li>First person replays</li>
                <li>Player profiles and statistics</li>
                <li>Replay analysis</li>
                <li>Friends list</li>
              </FeatureSectionList>
            </FeatureSection>
          </FeatureContainer>
        </SplashContainer>
        <ConnectedDialogOverlay />
      </React.Fragment>
    )
  }

  onSignUpClick = () => {
    this.props.dispatch(push({ pathname: '/signup' }))
  }

  onDownloadClick = () => {
    this.props.dispatch(openDialog('download'))
  }
}

export default connect()(Splash)
