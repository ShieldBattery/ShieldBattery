import React, { useState } from 'react'
import styled from 'styled-components'
import { Body1, headline5 } from '../../styles/typography'
import Card from '../card'
import { TabItem, Tabs } from '../tabs'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px !important;
  border-left: var(--pixel-shove-x, 0) solid transparent;
`

const DemoCard = styled(Card)`
  min-width: 400px;
  max-width: 640px;
  padding: 0;

  & + & {
    margin-top: 32px;
  }
`

const CardHeadline = styled.div`
  ${headline5};
  margin: 8px 16px;
`

const DemoContent = styled.div<{ $scrollable?: boolean }>`
  padding: 16px;
  overflow-y: auto;

  max-height: ${props => (props.$scrollable ? '400px' : 'unset')};
`

function FirstTab() {
  return (
    <>
      <Body1 as='p'>
        Micro Gamerz cross land wrong several firebats dire. Stopping sVEN trOt 2 fac vults straight
        line Triad no Brushfire observe here subject spread remember chamber Crystal Castles bed
        Heartwood her. Story those closely iX little summer starcraft score warrant. IwL- star
        capitol than blood fearing wave particular sigamari sand Binary Burghs raynor. Liftoff
        Legacy of Char together wastelands once place pinOkiO sign sair/reaver chaos Korhal of Ceres
        seek some asphalt Bizzy ways Pomi meant. Reach consonant?
      </Body1>
      <Body1 as='p'>
        Tiny except men surveyed rule Symmetry of Psy Last options water fat finger learn
        Continental Divide create archons assumed verb throw while? Ata burrowing cow achieve final
        glorious stead Naugrim 9 pool speed cost smile but decimal dylarian reduce talisman. Might
        glowing spread? Come Dark Stone x6AMD Sneazel unship ips Ringing Bloom cost ace spell Yayba
        initing. Atlantis operation coat would number Elysion flower jump Scarlett money anc hot KOR
        armed eX. place. Double charon money shock skzlime town arclite us if! IeS Virtual Gaming
        dead IFU especially swim felt population right Jim Raynor's Memory magnet agents hold osR
        forces forge admiral RainBOw Justin hf. Sunny back fly. Hope Polypoid?
      </Body1>
      <Body1 as='p'>
        Wheel help this material. Optical abilities beat save war spring protected enable lasers
        lives Julia produce energy page capital. Toggle tire mutation desert fig ear story consider
        hand raise nature apial. Create said master last Notice ons log another aMeBa note defending
        triangle feeling Optimizer. Follow revealer position region tougher particular city how
        Sapphire badlands equate of titan cv stove Dream.t)check glave high!
      </Body1>
    </>
  )
}

function SecondTab() {
  return (
    <>
      <Body1 as='p'>
        Triad CasterMuse soil point high DF letter boat IRk Sea.KH best Desert Bloom eco number
        Strelok? Rope Optimizer M18M xLo. Bbyong abilities uncontested material danger throw
        dylarian happy jump GohaN cave remember. Tiny defending meet coat weapon display flower
        dugalle JnSx Horizon Lunar Colony thousand chobo Chaotic Surface please 2 fac vults (OD)
        leave Arcneon dollar Electric Circuit. Feel powerups geyser alc. Far off Junitoss fake fake
        double report Rookie staging tube tough overrunning gravitic herO[jOin] follow ZergbOy[fOu]
        wood all seven 11 gas 10 pool Sniper Ridge.
      </Body1>
      <Body1 as='p'>
        IwL- facilities dark. Backwoods go SoU trade gaming hill divide. Both defilers HwangSin.
        SouLGaming nOOB started. Lady oxygen industrial operate caught raider SKELTON omen reply
        season. Swarm carry merge blow 1 rax FE debug shielded second.
      </Body1>
    </>
  )
}

function ThirdTab() {
  return (
    <>
      <Body1 as='p'>
        Heat direct defilers SKELTON nuclear exclusive Shadowplay geyser. Turn guild +3 prequel
        Blade Storm stand Fenix Betsson Voodoo Gaming. Cause dylarian hill follow shielded afreeca
        before back experience speech divide horse started soon fuSion. 3 hatch muta Luxury Highland
        Denizens HwangSin swirling ball made grand Opposing City States '98 spread! NarutO very
        detector century MiStrZZZ. Odd-Eye bed light front column action NaW Match Point instantly
        get Black Lotus battery TurN nine missions paused. Natural beacon script imposing vulture
        silence. Tough still constructed were opponent color Casy lie excello?
      </Body1>
      <Body1 as='p'>
        Crescent Moon Jim Raynor's Memory Bassy infested quick Crow tentacle xlo. Slow century
        Rosewood dead fled commodore DaK place shields cut stationary 3 base spire Thin Ice imagine
        caught Fantasy. Enter The Dragon Crazy Critters called table BoA grass true long mission
        sacrifice coast. Six instant Mouz. flagship tool instituted nydus best earth stop ride with
        Giant Steps constant extinguished syllable tab depot. Installations collected match real
        burrowed believe obs crop same ElkY mark.
      </Body1>
      <Body1 as='p'>
        Stretch Gamei Kim Carrier right together Hypothermia LRM) cow alpha Chupung-Ryeong segment
        hoejja build be. GtB 1 fac starport colonists continent agree OSL had kaiser drive ragnasaur
        specialist network cook anger delay. Put Woon! Size both. Late comrade got arrived Stepping
        Stones.!
      </Body1>
    </>
  )
}

function FourthTab() {
  return (
    <>
      <Body1 as='p'>
        Separate ASL feeling rock river Blood Bath La Mancha citadel grew possible CCoMa ay oil
        communication. Full Moon each able horror gates TerrOr survivors own week some BGH grand
        independent. Defenders touch matter let Demonio Azul storm material track Caldera Sparkle
        energy planet few PsB RuBy attacked simple! Afraid 3D Clan. Hour wandering 13 pool muta
        gauss five progress Cross Game led unsuspecting thought rock DL sand down choosing badlands
        bottom degree. Pawning oil BRAT_OK sought fact AlfiO against picture 12 nexus cloud.
      </Body1>
      <Body1 as='p'>
        Seat. Wear SoNiC)BlacK Kaleidoscope mud province JinSu extended corrosive ocean SUMA GO lt
        Eye of Typhoon bread activate hat home. Kept write resources much particle double Mausoleum
        voice favor Arkanoid little quick unchallenged sOrry mysterious kogeT cause. Ice sSak chau
        assault scion. Devourer silent message detection FoR.. back liftoff Yosh ready sail oh ran
        blackened char sara port Frenzy acid. Cross the Line charon sentence Media supremacy LT set
        carriers rub Heart Attack Niza Geometry guess decade twilight denoted course twin. Complete
        incinerated arclite SvS_ Sexy Modesty power improved All Your Base never key build Tempest
        care Kd. Nightfall BossClub.
      </Body1>
      <Body1 as='p'>
        Ultralisk weight a point egg who GanZi Tropical Fever Obsidian dad all-in chair for
        outskirts. Raven art cannot Bisu Demon's Forest pressing hunter miss WCG archives power
        mission seed soil true ESC Icy Box will Triad mutalisk ultra. Leave new River of Flames
        ghost. Existence optical constant group Switchback Marine soldier trOt LYH nine speed.
        Installations stand Bong[S.G] sight come game set disable surprise stood Hexer. FiSheYe
        options fake goliath captain.
      </Body1>
    </>
  )
}

export function TabsTest() {
  const [activeTab, setActiveTab] = useState(0)

  let tabContent: React.ReactNode
  switch (activeTab) {
    case 0:
      tabContent = FirstTab()
      break
    case 1:
      tabContent = SecondTab()
      break
    case 2:
      tabContent = ThirdTab()
      break
    default:
      tabContent = FourthTab()
      break
  }

  return (
    <Container>
      <DemoCard>
        <CardHeadline>No scrolling</CardHeadline>
        <Tabs bottomDivider={true} activeTab={activeTab} onChange={setActiveTab}>
          <TabItem text='First' value={0} />
          <TabItem text='Second' value={1} />
          <TabItem text='Third' value={2} />
          <TabItem text='Fourth' value={3} />
        </Tabs>
        <DemoContent>{tabContent}</DemoContent>
      </DemoCard>

      <DemoCard>
        <CardHeadline>Scrolling</CardHeadline>
        <Tabs bottomDivider={true} activeTab={activeTab} onChange={setActiveTab}>
          <TabItem text='First' value={0} />
          <TabItem text='Second' value={1} />
          <TabItem text='Third' value={2} />
          <TabItem text='Fourth' value={3} />
        </Tabs>
        <DemoContent $scrollable={true}>{tabContent}</DemoContent>
      </DemoCard>
    </Container>
  )
}
