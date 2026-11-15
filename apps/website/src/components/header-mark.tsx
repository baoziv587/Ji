import { Seal } from '~/components/seal'
import { headerMarkOf } from '~/lib/marks'

/**
 * The header mark. Every time the header mounts, a JI hops in from the right, lands on the 极
 * seal and stomps it flat in three beats (light, light, then a wound-up slam), then stands where
 * the seal was. The rest state, and the only state under reduced motion, is the JI alone.
 * The keyframes are .stomp-* in styles.css.
 */
export function HeaderMark() {
  return (
    <span className="stomp">
      <span className="stomp-ring" aria-hidden />
      <span className="stomp-chip stomp-chip--l" aria-hidden />
      <span className="stomp-chip stomp-chip--r" aria-hidden />
      <span className="stomp-seal">
        <Seal size={40} alt="" />
      </span>
      <span className="stomp-x">
        <span className="stomp-y">
          <span className="stomp-body">
            <img className="dark-only" src={headerMarkOf('paper')} width={65} height={80} alt="" />
            <img className="light-only" src={headerMarkOf('charcoal')} width={65} height={80} alt="" />
          </span>
        </span>
      </span>
    </span>
  )
}
