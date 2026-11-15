import { z } from 'zod'
import logoManifest from '../../public/logos/manifest.json'
import paperRecord from '../../public/logos/paper.json'
import qinglvRecord from '../../public/logos/qinglv.json'
import silkManifest from '../../public/qinglv-silk/manifest.json'
import { logos, paper, qinglv } from '../logos.ts'

// The manifests come from the ji.dev asset pipeline; parsing them here makes a stale or
// hand-edited manifest fail the build instead of shipping a broken page.
const Hex = z.string().regex(/^#[\da-f]{6}$/i)
const Size = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

const LogoRecord = z.object({
  id: z.enum(logos.map(logo => logo.id)),
  ink: Hex,
  svgSize: Size,
})

const QinglvRecord = z.object({
  stops: z
    .array(
      z.object({
        offset: z.string(),
        color: Hex,
      }),
    )
    .min(2),
  svgSize: Size,
})

const PaperRecord = z.object({
  fill: Hex,
  svgSize: Size,
  webpSize: Size,
  /** A small render for on-page use; the full WebP is the download. */
  thumbnail: Size.extend({
    file: z.string(),
  }),
})

const SilkRecord = z.object({
  svg: z.object({
    file: z.string(),
  }),
  webp: Size.extend({
    file: z.string(),
  }),
  background: z.object({
    base: Hex,
    noise: z.string(),
    tileSize: z.number().positive(),
  }),
})

export interface Colorway {
  readonly id: string
  readonly name: string
  readonly svg: string
  readonly webp: string
  readonly width: number
  readonly height: number
  /** CSS background showing the ink: a flat color or the qinglv gradient. */
  readonly swatch: string
  readonly inkLabel: string
}

const logoFiles = (id: string) => ({ svg: `/logos/${id}.svg`, webp: `/logos/${id}.webp` })
const records = new Map(
  z
    .array(LogoRecord)
    .parse(logoManifest)
    .map(record => [record.id, record]),
)
const qinglvData = QinglvRecord.parse(qinglvRecord)
const qinglvStops = qinglvData.stops.map(stop => `${stop.color} ${stop.offset}`).join(', ')
const paperData = PaperRecord.parse(paperRecord)

export const colorways: readonly Colorway[] = [
  {
    id: qinglv.id,
    name: qinglv.name,
    ...logoFiles(qinglv.id),
    ...qinglvData.svgSize,
    swatch: `linear-gradient(to bottom, ${qinglvStops})`,
    inkLabel: `${qinglvData.stops[0]!.color} → ${qinglvData.stops.at(-1)!.color}`,
  },
  ...logos.map(logo => {
    const record = records.get(logo.id)
    if (!record) throw new Error(`public/logos/manifest.json has no entry for ${logo.id}`)
    return {
      ...logo,
      ...logoFiles(logo.id),
      ...record.svgSize,
      swatch: record.ink,
      inkLabel: record.ink,
    }
  }),
  {
    id: paper.id,
    name: paper.name,
    ...logoFiles(paper.id),
    ...paperData.svgSize,
    swatch: paperData.fill,
    inkLabel: `${paperData.fill}，用于墨底`,
  },
]

/** The paper-white logo the home page shows as a rubbing on ink, sized for the footer. */
export const rubbing = {
  webp: `/logos/${paperData.thumbnail.file}`,
  width: paperData.thumbnail.width,
  height: paperData.thumbnail.height,
}

const silkData = SilkRecord.parse(silkManifest)

export const silk = {
  name: '青绿绢本',
  svg: `/qinglv-silk/${silkData.svg.file}`,
  webp: `/qinglv-silk/${silkData.webp.file}`,
  noise: `/qinglv-silk/${silkData.background.noise}`,
  width: silkData.webp.width,
  height: silkData.webp.height,
  background: silkData.background,
}
