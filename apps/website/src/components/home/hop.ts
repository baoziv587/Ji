// The JI that hops between the hero's example tabs, as Web Animations so a hop can start on demand and the tab can
// switch on the frame the JI lands. Same character as the header stomp (styles.css, .stomp-*): four nested layers so
// each motion has one job: across (x), up and lean (y), which way it faces (face), squash and stretch (body). Every
// jump has the same beats: notice the target, crouch, launch stretched, round at the top, stretch falling, squash on
// impact, overshoot, settle. The word it leaves dips under the push-off; the word it lands on is squashed and springs
// back.

/** The JI's four layers, outermost first. */
export interface Rig {
  x: HTMLElement
  y: HTMLElement
  face: HTMLElement
  body: HTMLElement
}

export type Facing = 1 | -1

export interface Jump {
  /** Rest positions, px from the stage's left edge. */
  from: number
  to: number
  facing: Facing
  /** Apex height in px. */
  height: number
  /** The word it pushes off from and the word it lands on. */
  leaving?: HTMLElement
  landing: HTMLElement
  /** A person picked the tab: skip the glance, the tab has already switched. */
  quick?: boolean
}

export interface Played {
  /** When the feet touch the landing word, in ms from the start. */
  impactAt: number
  done: Promise<void>
  facing: Facing
  /** Ends every animation at its last frame, for when a new jump interrupts this one. */
  finish: () => void
}

// The header stomp's curves: rises ease out, falls ease in, settles are quick and soft.
const RISE = 'cubic-bezier(0.2, 0.75, 0.35, 1)'
const FALL = 'cubic-bezier(0.55, 0, 0.9, 0.45)'
const SETTLE = 'cubic-bezier(0.3, 0, 0.2, 1)'
const SHAPE = 'cubic-bezier(0.3, 0.6, 0.4, 1)'
/** Across the air at nearly constant speed, as a thrown thing moves. */
const GLIDE = 'cubic-bezier(0.3, 0, 0.7, 1)'

type Frame = readonly [ms: number, keyframe: Keyframe]

/** Keyframes at absolute times; each frame's `easing` shapes the segment that starts there. */
function track(el: HTMLElement, total: number, frames: readonly Frame[], easing = SHAPE): Animation {
  const keyframes = frames.map(([ms, frame]) => ({ easing, ...frame, offset: Math.min(1, ms / total) }))
  return el.animate(keyframes, { duration: total, fill: 'both' })
}

const scale = (x: number, y: number) => `scale(${x}, ${y})`
const lift = (px: number, deg: number) => `translateY(${px}px) rotate(${deg}deg)`

/** Keeps where the layers ended up as plain styles, then drops the animations so nothing piles up. */
function settle(animations: Animation[]): Promise<void> {
  return Promise.all(animations.map(a => a.finished)).then(
    () => {
      for (const a of animations) {
        a.commitStyles()
        a.cancel()
      }
    },
    () => {},
  )
}

function played(animations: Animation[], impactAt: number, facing: Facing): Played {
  return {
    impactAt,
    facing,
    done: settle(animations),
    finish: () => animations.forEach(a => a.finish()),
  }
}

/** The landing word: squashed under the feet, then springs back past flat. */
function stomped(el: HTMLElement, total: number, at: number, hard: boolean): Animation {
  return track(el, total, [
    [0, { transform: scale(1, 1) }],
    [at, { transform: scale(1, 1) }],
    [at + 50, { transform: hard ? scale(1.12, 0.7) : scale(1.09, 0.76) }],
    [at + 170, { transform: scale(0.97, 1.06) }],
    [at + 280, { transform: scale(1.01, 0.99) }],
    [at + 360, { transform: scale(1, 1) }],
  ])
}

/** How long each beat of a jump takes, in ms; a far jump winds up longer and flies longer. */
function beats(j: Jump) {
  const dir: Facing = j.to >= j.from ? 1 : -1
  const big = Math.abs(j.to - j.from) > 120 && !j.quick
  const pace = j.quick ? { ready: 140, air: 360 } : big ? { ready: 480, air: 640 } : { ready: 320, air: 440 }
  return {
    dir,
    big,
    ...pace,
    // Facing the wrong way: turn first, with a small hop, as a person would
    turn: j.facing === dir ? 0 : 280,
    // Landed facing left: once steady, turn back to the reader, so the mark never rests mirrored
    back: dir === -1 ? 300 : 0,
  }
}

/** Frames that only a turn has; none when there is no turn. */
const turning = (ms: number, frames: readonly Frame[]): readonly Frame[] => (ms > 0 ? frames : [])

export function jump(rig: Rig, j: Jump): Played {
  const { dir, big, ready, air, turn, back } = beats(j)
  const steady = turn + ready + air + 380
  const total = steady + back

  const lean = 7 * dir
  const offAt = turn + ready
  const impactAt = offAt + air
  const crouch = big ? scale(1.24, 0.76) : scale(1.16, 0.84)
  const apex = -j.height * (big ? 1.5 : 1)
  const glance = turn + ready * 0.4

  const animations = [
    // Across: a 2px draw back while crouching, the flight, a skid past the mark, back onto it
    track(
      rig.x,
      total,
      [
        [0, { transform: `translateX(${j.from}px)` }],
        [offAt - 40, { transform: `translateX(${j.from - 2 * dir}px)`, easing: 'linear' }],
        [offAt, { transform: `translateX(${j.from - 2 * dir}px)`, easing: GLIDE }],
        [impactAt, { transform: `translateX(${j.to}px)`, easing: SETTLE }],
        [impactAt + 110, { transform: `translateX(${j.to + 2 * dir}px)`, easing: SETTLE }],
        [total, { transform: `translateX(${j.to}px)` }],
      ],
      'linear',
    ),
    // Up and lean: a look toward the target, deeper as it crouches, dragged back at the top, thrown forward on landing
    track(rig.y, total, [
      [0, { transform: lift(0, 0), easing: RISE }],
      ...turning(turn, [[turn * 0.45, { transform: lift(-6, 0), easing: FALL }]]),
      [turn, { transform: lift(0, 0), easing: SETTLE }],
      [glance, { transform: lift(0, lean * 0.8), easing: SETTLE }],
      [offAt - 40, { transform: lift(0, lean * 1.3), easing: SETTLE }],
      [offAt, { transform: lift(0, lean * 0.5), easing: RISE }],
      [offAt + air * 0.5, { transform: lift(apex, -lean * 0.4), easing: FALL }],
      [impactAt, { transform: lift(0, lean * 0.9), easing: SETTLE }],
      [impactAt + 130, { transform: lift(0, -lean * 0.4), easing: SETTLE }],
      [impactAt + 260, { transform: lift(0, lean * 0.15), easing: SETTLE }],
      [steady, { transform: lift(0, 0), easing: RISE }],
      ...turning(back, [[steady + back * 0.45, { transform: lift(-5, 0), easing: FALL }]]),
      [total, { transform: lift(0, 0) }],
    ]),
    // Which way it faces: turns through edge-on
    track(
      rig.face,
      total,
      [
        [0, { transform: `scaleX(${j.facing})` }],
        [turn, { transform: `scaleX(${dir})` }],
        [steady, { transform: `scaleX(${dir})` }],
        [total, { transform: 'scaleX(1)' }],
      ],
      SETTLE,
    ),
    // Shape: crouch before take-off, stretch only while fast, squash on impact
    track(rig.body, total, [
      [0, { transform: scale(1, 1) }],
      ...turning(turn, [
        [turn * 0.15, { transform: scale(1.1, 0.9) }],
        [turn * 0.5, { transform: scale(0.94, 1.06) }],
        [turn, { transform: scale(1.06, 0.94) }],
      ]),
      [glance, { transform: scale(1, 1) }],
      [offAt - 40, { transform: crouch }],
      [offAt, { transform: scale(0.84, 1.2) }],
      [offAt + air * 0.45, { transform: scale(1, 1) }],
      [impactAt - 30, { transform: scale(0.9, 1.12) }],
      [impactAt, { transform: big ? scale(1.38, 0.64) : scale(1.3, 0.72) }],
      [impactAt + 110, { transform: scale(0.93, 1.08) }],
      [impactAt + 220, { transform: scale(1.03, 0.97) }],
      [impactAt + 320, { transform: scale(1, 1) }],
      [steady, { transform: scale(1, 1) }],
      ...turning(back, [
        [steady + back * 0.15, { transform: scale(1.08, 0.92) }],
        [steady + back * 0.5, { transform: scale(0.95, 1.05) }],
      ]),
      [total, { transform: scale(1, 1) }],
    ]),
    stomped(j.landing, total, impactAt, big),
  ]

  if (j.leaving) {
    // The push-off loads the word it stands on: it dips at take-off and springs back once the feet leave
    animations.push(
      track(j.leaving, total, [
        [0, { transform: scale(1, 1) }],
        [offAt - 40, { transform: scale(1.03, 0.92) }],
        [offAt, { transform: scale(1.05, 0.86) }],
        [offAt + 120, { transform: scale(0.98, 1.05) }],
        [offAt + 240, { transform: scale(1, 1) }],
        [total, { transform: scale(1, 1) }],
      ]),
    )
  }

  return played(animations, impactAt, 1)
}

/** The entrance: falls onto the first word, already stretched, and squashes it. */
export function drop(rig: Rig, at: number, landing: HTMLElement, height: number): Played {
  const impactAt = 380
  const total = impactAt + 400
  const animations = [
    track(
      rig.x,
      total,
      [
        [0, { transform: `translateX(${at}px)`, opacity: 0 }],
        [100, { transform: `translateX(${at}px)`, opacity: 1 }],
        [total, { transform: `translateX(${at}px)`, opacity: 1 }],
      ],
      'linear',
    ),
    track(rig.y, total, [
      [0, { transform: lift(-height * 1.6, -4), easing: FALL }],
      [impactAt, { transform: lift(0, 3), easing: SETTLE }],
      [impactAt + 140, { transform: lift(0, -1.5), easing: SETTLE }],
      [total, { transform: lift(0, 0) }],
    ]),
    track(rig.body, total, [
      [0, { transform: scale(0.9, 1.12) }],
      [impactAt - 30, { transform: scale(0.88, 1.14) }],
      [impactAt, { transform: scale(1.34, 0.68) }],
      [impactAt + 110, { transform: scale(0.93, 1.08) }],
      [impactAt + 220, { transform: scale(1.03, 0.97) }],
      [impactAt + 320, { transform: scale(1, 1) }],
      [total, { transform: scale(1, 1) }],
    ]),
    stomped(landing, total, impactAt, false),
  ]
  return played(animations, impactAt, 1)
}
