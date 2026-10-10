import { useTranslation } from 'react-i18next'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { makePublicAssetUrl } from '../network/server-url'
import { escapeMarkdownImageText, ExplainerDialog } from './explainer-dialog'

export function MatchmakingExplainerDialog({ onCancel }: CommonDialogProps) {
  const { t } = useTranslation()

  const exampleAlt = escapeMarkdownImageText(
    t(
      'matchmaking.explainer.exampleImageAlt',
      'A table of possible 2v2 matches between six queued players, ranked by score',
    ),
  )
  const exampleCaption = escapeMarkdownImageText(
    t(
      'matchmaking.explainer.exampleImageCaption',
      'A made-up example. The scores use the matchmaker’s real formula.',
    ),
  )
  const exampleUrl = makePublicAssetUrl('images/matchmaking-explainer-search.png')

  const markdown = [
    t(
      'matchmaking.explainer.intro',
      'One question comes up in our community more than almost any other:\n\n*“A game started ' +
        'while I was in the queue. Why wasn’t I in it?”*\n\nThe answer comes from how ' +
        'ShieldBattery’s matchmaker is built. This guide walks through how a match gets put ' +
        'together, from the moment you click “Find match” to the moment the game loads.',
    ),
    t(
      'matchmaking.explainer.dynamicSearch',
      '## Dynamic Search\n\nA common guess is that the ShieldBattery queue is first-come, ' +
        'first-served, and that the person waiting the longest will be in the next game. That’s ' +
        'not necessarily how it works. That system tends to produce more lopsided games on ' +
        'average. A brand-new player could be paired with someone in Champion just because they ' +
        'clicked “Find match” at the same time.\n\nThe matchmaker runs a search every few ' +
        'seconds instead. Each time, for each mode (1v1, 2v2, 3v3 BGH, and so on), it:\n\n1. ' +
        '**Picks a random sample of the players queued for that mode.** If only a few players ' +
        'are searching, that’s all of them. When the queue is busy, it’s a random set of about ' +
        'twenty. The sample is fully random, so everyone has the same chance of being looked at ' +
        'in each search, however long they’ve been waiting.\n2. **Tries every possible group ' +
        'from that sample.** For team modes, it also tries every way of splitting each group ' +
        'into two teams and keeps the most even split.\n3. **Gives each possible match a ' +
        'quality score.**\n4. **Starts the best matches that score high enough.** Each player ' +
        'can only be in one match, so once someone is used in a high-scoring match, any ' +
        'lower-scoring match that needed them is dropped.\n\nAnyone who isn’t matched simply ' +
        'stays in the queue for the next search a few seconds later.',
    ),
    t(
      'matchmaking.explainer.qualityIndex',
      '## Quality Index\n\nA match’s quality score weighs **how long the players have ' +
        'waited** against **how good the game is likely to be**. The score is measured in ' +
        'seconds of waiting. Put simply, each flaw in a match costs a set number of seconds. A ' +
        'match can start once the players’ time in queue overcomes the downsides of the ' +
        'proposed match.\n\nThose downsides include:\n\n* **Skill spread.** How far apart ' +
        'everyone’s ratings (MMR) are. This is the biggest factor, and the queue time penalty ' +
        'increases rapidly as the gap gets wider.\n* **Balance.** How likely one side is to ' +
        'win. A 50/50 match costs nothing, while a match one side is heavily expected to win ' +
        'costs more queue time.\n* **Latency.** Your connection only matters once it’s bad ' +
        'enough to change how the game feels. StarCraft plays the same at 30ms as it does at ' +
        'around 100ms. Past that, the game feel is impacted. So matches cost nothing for ' +
        'latency until they cross one of our defined thresholds, and then each step costs extra ' +
        'waiting time. The estimate is based on the server region each player picked and their ' +
        'measured ping to it.\n\nThe wait time used is that of **whoever in the match has ' +
        'waited longest**. So a player who has been searching for several minutes makes every ' +
        'match they could be in easier to start, including one with you, even if you only just ' +
        'joined.\n\nHere’s what a single 2v2 search might look like. Skill, Balance and Ping ' +
        'are the costs of each flaw, in seconds. A match’s score is the longest wait, plus a ' +
        '30-second head start, minus those costs. A match can start once its score reaches 0. ' +
        'Matches are started from the top down, and each player can only be in one.',
    ),
    `![${exampleAlt}](${exampleUrl} "${exampleCaption}")`,
    t(
      'matchmaking.explainer.qualityExample',
      'Arbiter has been waiting the longest, so every match with Arbiter in it gets a boost. ' +
        'Several of those matches are ready to go, including one with you. But Arbiter, Reaver, ' +
        'Valkyrie and Goliath are all close to each other in rating, so the match with just ' +
        'those four has the lowest skill cost and starts first. That leaves only you and ' +
        'Defiler, which isn’t enough for a 2v2, so every other match is skipped. You both stay ' +
        'in the queue for the next search, and your wait keeps counting.\n\nTo give a rough ' +
        'sense of scale, here’s how long a 1v1 needs before it can start under our standard ' +
        'tuning, assuming good connections:\n\n* **Ratings about 100 apart:** almost ' +
        'immediately\n* **About 200 apart:** around a minute and a half\n* **About 300 apart:** ' +
        'around three and a half minutes\n* **About 400 apart:** around six and a half ' +
        'minutes\n\nWe adjust these settings over time as we learn more, so treat the numbers ' +
        'as loose approximations. The weights on each factor that we use are also independently ' +
        'configured per game mode.',
    ),
    t(
      'matchmaking.explainer.quietHours',
      '## Quiet Hours\n\nWhen few people are playing, holding out for a close match might ' +
        'mean nobody gets a game at all. The matchmaker keeps a running estimate of how many ' +
        'people have been queuing for each mode recently. When that number drops below a ' +
        'healthy level, it lowers the bar so matches can start sooner. When things pick up ' +
        'again, the bar goes back up.',
    ),
    t(
      'matchmaking.explainer.newPlayers',
      '## New and Returning Players\n\nEvery player has a separate rating for each mode, and ' +
        'that rating comes with an **uncertainty**, which says how sure the system is about ' +
        'your skill. While that uncertainty is high (when you’re new, or coming back after a ' +
        'break), the matchmaker uses a cautious estimate of your skill. You’ll start out ' +
        'against a range of opponents, and the system settles in quickly as you play.',
    ),
    t(
      'matchmaking.explainer.mapChoices',
      '## Map Choices\n\n* In modes with **map vetoes** (like 1v1 and 2v2), vetoes never stop ' +
        'you from being matched. They only affect which map gets picked once the match is ' +
        'made.\n* In modes where you **pick the maps you want** (the Fastest modes), you can ' +
        'only be matched with players who picked at least one of the same maps. If you pick ' +
        'only one map, there are fewer people you can be matched with.',
    ),
    t(
      'matchmaking.explainer.whyNotMe',
      '## So Why Did A Game Start Without Me?\n\nPutting it together, here are the usual ' +
        'reasons:\n\n* **The players in it were a better fit for each other than for you.** ' +
        'Their ratings were closer to each other’s, or their connections to each other were ' +
        'better. The matchmaker always takes the best available match first.\n* **Someone in ' +
        'that match had waited longer.** Their wait time let a match form that wasn’t ready yet ' +
        'with you in it.\n* **It was a different mode.** Players can queue for several modes at ' +
        'once, and a game that starts in 2v2 doesn’t involve the 1v1 queue.\n* **The sample ' +
        'didn’t include you that time.** On a busy queue, each search looks at a random sample. ' +
        'You have the same chance as everyone else in every search, and searches happen every ' +
        'few seconds.\n* **Your map picks didn’t overlap** (Fastest modes only).\n\nNone of ' +
        'these means your place in the queue was skipped or reset. Your wait time keeps ' +
        'counting, and as it grows, the matchmaker accepts a wider range of matches for you.',
    ),
    t(
      'matchmaking.explainer.matchFallsThrough',
      '## When A Match Falls Through\n\nWhen a match is found, everyone has 60 seconds to ' +
        'accept. If someone declines, doesn’t respond, or fails to load into the game, the ' +
        'match is cancelled. **Everyone else goes back into the queue with their original wait ' +
        'time**, so you don’t start over because someone else wasn’t ready.\n\nThe player who ' +
        'caused the failure gets a matchmaking penalty. The first time is just a warning. ' +
        'Repeat offenses lead to short matchmaking timeouts that get longer each time, and ' +
        'which clear up after a period of good behavior.',
    ),
    t(
      'matchmaking.explainer.wrapUp',
      '## Wrapping Up\n\n* The matchmaker looks for the **best match** as opposed to the next ' +
        'person in line.\n* Each match is scored on skill spread, balance and latency, weighed ' +
        'against how long the players have waited.\n* Waiting longer makes it less picky, and ' +
        'that includes other players’ wait times.\n* If a match falls through because of ' +
        'someone else, you keep your place.\n\nSee you in the queue!',
    ),
  ].join('\n\n')

  return (
    <ExplainerDialog
      title={t('matchmaking.explainer.title', 'How matchmaking works')}
      markdown={markdown}
      onCancel={onCancel}
    />
  )
}
