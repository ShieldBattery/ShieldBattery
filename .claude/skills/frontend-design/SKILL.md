---
name: frontend-design
description: Create distinctive, engaging frontend interfaces for ShieldBattery. Use this skill when building user interfaces. Encourages bold, intentional design decisions within the project's design system.
---

## Before You Write Code

Every UI tells a story. Before touching the keyboard, answer these:

**What's the emotional core?**

- A replay browser is about _nostalgia and rediscovery_—reliving great moments
- Match results are about _pride and reflection_—celebrating what happened
- Matchmaking is about _anticipation and tension_—building toward something
- Leaderboards are about _aspiration and competition_—where do I stand?

What is _this_ feature really about? Name the feeling.

**What will someone remember?**
Pick one element that makes this UI distinctive. Not five. One. Maybe it's:

- A satisfying animation when something important happens
- A bold use of color that immediately communicates state
- A moment of delight that rewards the user's attention
- An unexpected bit of polish that shows craft

**What's the energy level?**

- **High energy**: Match results, rank-ups, achievements, victories. Orchestrated animations, bold colors, dramatic reveals.
- **Medium energy**: Browsing, discovery, social features. Smooth transitions, clear hierarchy, moments of personality.
- **Low energy**: Settings, configuration, system UI. Clean, efficient, invisible. The UI gets out of the way.

Match the energy to the moment. Not everything needs to be exciting—but the exciting things need to _feel_ exciting.

## What Bold Looks Like Here

A few moments in ShieldBattery that show the level of craft to aim for:

**The post-match rank reveal.** When your division changes, the icon doesn't just appear—it scales in with a spring bounce, brightness flares, and a sound plays. That half-second of choreographed animation transforms "you ranked up" from information into _feeling_.

**Win/loss colors you can read across the room.** Match results don't use subtle tints. Victories are bright green (`--theme-positive`), defeats are clear red (`--theme-negative`). There's no ambiguity. The color _is_ the message.

**The draft screen timer.** As time runs low, the color shifts from calm to amber to urgent red. You feel the pressure without reading a number. The UI communicates through instinct, not interpretation.

**Staggered point reveals.** In the post-match dialog, your points and rating don't appear all at once. They animate in sequence—points first, then rating—with sound cues on each reveal. The delay creates anticipation; the stagger creates rhythm.

These aren't decorations. Each one makes the experience _feel_ like something. That's the bar.

## The ShieldBattery Identity

This is a platform for competitive StarCraft players. The UI should feel like it respects their time and skill:

**Precise, not sloppy.** Alignments matter. Spacing is intentional. Nothing feels accidental.

**Responsive, not sluggish.** Interactions acknowledge input immediately. Animations have purpose, not padding.

**Confident, not timid.** When something is important, make it important. Don't hedge with muted colors and small text when the moment calls for boldness.

**Crafted, not generic.** A ShieldBattery feature should feel like it belongs to ShieldBattery, not like it was pulled from a template.

## Making Bold Decisions

You have permission to:

**Use the full color palette.** The design system has semantic colors for a reason—`--theme-positive` for wins, `--theme-negative` for losses, race colors for faction identity. When the context calls for it, _use them confidently_.

**Create moments with motion.** The project uses `motion/react` for orchestrated animations. A well-timed staggered reveal or a satisfying spring animation can transform a feature from functional to memorable. See `post-match-dialog.tsx` for how this is done well.

**Establish visual hierarchy ruthlessly.** Not everything is equally important. Make the important things big, bold, and obvious. Let secondary information recede. If you're not sure what's most important, that's a design problem to solve before coding.

**Let the content breathe.** Generous spacing isn't wasted space—it's emphasis. Dense UIs have their place, but know when you're building a cockpit vs. a gallery.

## Asking the Right Questions

When you're stuck, these questions usually help:

- What would make a player _want_ to show this to a friend?
- If I removed this element, would anyone miss it?
- What's the most important thing on this screen? Is that obvious in 2 seconds?
- Am I being bold because it serves the user, or just because I can?
- Does this feel like ShieldBattery, or could it be any app?

## Technical Grounding

The design system provides the vocabulary. Use it:

- **Colors**: `client/styles/colors.ts` — theme variables, race colors, container elevation
- **Typography**: `client/styles/typography.ts` — Inter for body, Sofia Sans for titles, defined scale
- **Components**: `client/material/` — buttons, dialogs, inputs, menus (extend, don't recreate)
- **Animation**: `motion/react` with spring physics, `client/material/curves.ts` for CSS transitions
- **Icons**: `MaterialIcon` component with [Material Symbols](https://fonts.google.com/icons)

For patterns, look at existing features:

- `post-match-dialog.tsx` — orchestrated animations, staggered reveals, sound integration
- `mini-match-history.tsx` — interactive lists, semantic colors for results
- `draft-screen.tsx` — timer states, urgency through color

**Use `$`-prefixed props** for styled-components (`$active`, `$disabled`, `$focused`).

---

**The goal is not to be safe. The goal is to be intentional.**

A boring UI is a failure of imagination. A chaotic UI is a failure of discipline. The best ShieldBattery features are bold _and_ cohesive—they have personality that serves the player.
