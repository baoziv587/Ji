import type { RefObject } from 'react'
import type { Facing, Played, Rig } from '~/components/home/hop'
import { useEffect, useRef } from 'react'
import { drop, jump } from '~/components/home/hop'

/** Long enough to see what an example is about; to read it, a reader points at it and the rotation waits. */
const DWELL_MS = 4000
/** A beat after the header stomp ends, so the two JIs never move at once: one finishes, then the other enters. */
const ENTER_BEAT_MS = 450

/** The JI's height in px, and the air between its feet and the top of the word it stands on. */
const JI_H = 28
const JI_W = (JI_H * 65) / 80
const GAP = 4

/** Resolves once the header stomp (src/components/header-mark.tsx) has played, or at once if it is not playing. */
function afterHeaderStomp(): Promise<void> {
  const running = document.querySelector('.stomp-x')?.getAnimations() ?? []
  // A cancelled stomp (the header unmounted) rejects: enter anyway
  return Promise.allSettled(running.map(animation => animation.finished)).then(() => {})
}

interface Options {
  /** Hover or focus here pauses the rotation; scrolling it out of view pauses it too. */
  root: RefObject<HTMLElement | null>
  /** The tab labels, in tab order: the words the JI stands on. */
  words: RefObject<Array<HTMLElement | null>>
  /** The JI landed on tab `index` by itself: switch to it. */
  onLand: (index: number) => void
}

/**
 * Drives the hero's tab JI: it drops onto the first tab, then every DWELL_MS hops to the next, round and round, and the
 * tab switches as it lands. It waits while the pointer or focus is in the examples, while they are off screen and while
 * the page is hidden; a hop already under way when the pointer comes in switches nothing, and the JI hops back. It
 * stops for good once someone picks a tab (then it only follows them). Under reduced motion it stands
 * still on the selected tab and nothing rotates.
 *
 * Put `stage` on the positioned box the JI moves in and the four rig refs on its layers, outermost first; call `pick`
 * when a person selects a tab.
 */
export function useTabHopper({ root, words, onLand }: Options) {
  const stageRef = useRef<HTMLDivElement>(null)
  const xRef = useRef<HTMLSpanElement>(null)
  const yRef = useRef<HTMLSpanElement>(null)
  const faceRef = useRef<HTMLSpanElement>(null)
  const bodyRef = useRef<HTMLSpanElement>(null)
  const pickRef = useRef<(index: number) => void>(() => {})
  const landRef = useRef(onLand)
  landRef.current = onLand

  useEffect(() => {
    const parts = { x: xRef.current, y: yRef.current, face: faceRef.current, body: bodyRef.current }
    const box = stageRef.current
    const area = root.current
    if (!box || !area || !parts.x || !parts.y || !parts.face || !parts.body) return
    const layers = parts as Rig
    const word = (i: number) => words.current[i]!
    const count = words.current.length

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    let at = 0
    let facing: Facing = 1
    let current: Played | undefined
    let stopped = reduced
    // An automatic hop in the air: the tab it left, until it lands; and the tab to hop back to, if it was called off
    let origin: number | undefined
    let recall: number | undefined
    // On stage: dropped in, or shown at once under reduced motion; gone once unmounted
    let entered = reduced
    let gone = false
    let hovered = false
    let focused = false
    let visible = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let impact: ReturnType<typeof setTimeout> | undefined

    function spot(i: number) {
      const s = box!.getBoundingClientRect()
      const w = word(i).getBoundingClientRect()
      return { x: w.left - s.left + w.width / 2 - JI_W / 2, top: w.top - s.top - GAP - JI_H }
    }

    function place(i: number) {
      const { x, top } = spot(i)
      layers.x.style.top = `${top}px`
      layers.x.style.transform = `translateX(${x}px)`
    }

    function play(next: Played, then?: () => void) {
      current = next
      void next.done.then(() => {
        if (current !== next) return
        current = undefined
        // The landing word turns semibold as it is selected, a pixel wider: stand on its new centre
        place(at)
        then?.()
      })
    }

    function hop(to: number, quick: boolean, then?: () => void) {
      current?.finish()
      clearTimeout(impact)
      const from = spot(at).x
      const target = spot(to)
      layers.x.style.top = `${target.top}px`
      const next = jump(layers, {
        from,
        to: target.x,
        facing,
        height: JI_H * 0.9,
        leaving: word(at),
        landing: word(to),
        quick,
      })
      facing = next.facing
      if (!quick) {
        impact = setTimeout(() => {
          origin = undefined
          landRef.current(to)
        }, next.impactAt)
      }
      at = to
      play(next, then)
    }

    // Not before it has dropped in: the first dwell starts when it lands
    const running = () => entered && !stopped && !hovered && !focused && visible && !document.hidden

    function schedule() {
      clearTimeout(timer)
      if (!running() || current) return
      timer = setTimeout(() => {
        if (!running()) return
        origin = at
        hop((at + 1) % count, false, afterAutoHop)
      }, DWELL_MS)
    }

    /** Landed by itself: wait for the next one, or, if the hop was called off mid-air, go back to the selected tab. */
    function afterAutoHop() {
      if (recall === undefined) return schedule()
      const back = recall
      recall = undefined
      hop(back, true, schedule)
    }

    function wake() {
      if (running()) return schedule()
      clearTimeout(timer)
      // Paused mid-air: the tab stays as it is under the reader's pointer, and the JI comes back to it
      if (origin !== undefined) {
        clearTimeout(impact)
        recall = origin
        origin = undefined
      }
    }

    pickRef.current = index => {
      stopped = true
      clearTimeout(timer)
      clearTimeout(impact)
      origin = undefined
      recall = undefined
      if (index === at && !current) return
      // Still off stage (reduced motion, or before it drops in): just stand there
      if (reduced || !entered) {
        at = index
        place(index)
      } else {
        hop(index, true)
      }
    }

    place(0)
    let enter: ReturnType<typeof setTimeout> | undefined
    if (reduced) {
      layers.x.style.opacity = '1'
    } else {
      void afterHeaderStomp().then(() => {
        if (gone) return
        enter = setTimeout(() => {
          entered = true
          // Someone picked a tab before it arrived: drop onto that one
          play(drop(layers, spot(at).x, word(at), JI_H), schedule)
        }, ENTER_BEAT_MS)
      })
    }

    const onEnter = () => {
      hovered = true
      wake()
    }
    const onLeave = () => {
      hovered = false
      wake()
    }
    const onFocusIn = () => {
      focused = true
      wake()
    }
    const onFocusOut = (event: FocusEvent) => {
      focused = area.contains(event.relatedTarget as Node | null)
      wake()
    }
    area.addEventListener('pointerenter', onEnter)
    area.addEventListener('pointerleave', onLeave)
    area.addEventListener('focusin', onFocusIn)
    area.addEventListener('focusout', onFocusOut)
    document.addEventListener('visibilitychange', wake)

    const seen = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? true
        wake()
      },
      { threshold: 0.4 },
    )
    seen.observe(area)

    // Fonts arrive and the column resizes: stand on the word where it now is
    const resized = new ResizeObserver(() => {
      if (!current) place(at)
    })
    resized.observe(box)
    words.current.forEach(w => w && resized.observe(w))

    return () => {
      gone = true
      clearTimeout(enter)
      clearTimeout(timer)
      clearTimeout(impact)
      current?.finish()
      area.removeEventListener('pointerenter', onEnter)
      area.removeEventListener('pointerleave', onLeave)
      area.removeEventListener('focusin', onFocusIn)
      area.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('visibilitychange', wake)
      seen.disconnect()
      resized.disconnect()
      pickRef.current = () => {}
    }
  }, [root, words])

  return {
    stage: stageRef,
    rig: { x: xRef, y: yRef, face: faceRef, body: bodyRef },
    pick: (index: number) => pickRef.current(index),
  }
}
