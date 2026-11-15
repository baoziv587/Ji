import paperRecord from '../../public/logos/paper.json'
import { logos, paper, qinglv } from '../logos.ts'

/**
 * The logo files that every page shows (header, footer, 404), without the manifest schemas in
 * ~/lib/catalog: those pull zod into the browser, and only /brand needs them. The manifests are
 * still checked at build time, because /brand is prerendered and parses them.
 */

/** Colourway ids in their order everywhere: qinglv, the five inks, then paper white. */
export const markIds: readonly string[] = [qinglv.id, ...logos.map(logo => logo.id), paper.id]

/** 234 × 288, for small moving uses such as the logo hop. */
export const thumbnailOf = (id: string) => `/logos/${id}-288.webp`

/** 65 × 80, the header mark at 40px on a 2× screen. Only paper and charcoal have one. */
export const headerMarkOf = (id: 'paper' | 'charcoal') => `/logos/${id}-80.webp`

/** The paper-white logo the home page shows as a rubbing on ink, sized for the footer. */
export const rubbing = {
  webp: `/logos/${paperRecord.thumbnail.file}`,
  width: paperRecord.thumbnail.width,
  height: paperRecord.thumbnail.height,
}
