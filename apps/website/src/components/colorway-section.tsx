import type { Colorway } from '~/lib/catalog'
import { DownloadLinks } from '~/components/download-links'
import { cn } from '~/lib/utils'

const previews = [
  {
    format: 'svg',
    surface: 'bg-preview-paper',
    caption: 'SVG · 暖纸底',
    alt: 'SVG，暖纸底预览',
  },
  {
    format: 'webp',
    surface: 'bg-checker',
    caption: 'WebP · 透明网格',
    alt: 'WebP，透明网格预览',
  },
  {
    format: 'webp',
    surface: 'bg-preview-dark',
    caption: 'WebP · 深底检查',
    alt: 'WebP，深底预览',
  },
] as const

export function ColorwaySection({ colorway }: { colorway: Colorway }) {
  const headingId = `colorway-${colorway.id}`
  return (
    <section aria-labelledby={headingId} className="border-b py-9">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="size-4 rounded-full ring-1 ring-border"
            style={{ background: colorway.swatch }}
          />
          <h2 id={headingId} className="text-xl font-semibold">
            {colorway.name}
          </h2>
          <span className="text-sm text-muted-foreground tabular-nums">{colorway.inkLabel}</span>
        </div>
        <DownloadLinks
          label={colorway.name}
          files={[
            { text: 'SVG', href: colorway.svg },
            { text: 'WebP', href: colorway.webp },
          ]}
        />
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-5">
        {previews.map(preview => (
          <figure key={preview.caption}>
            <div className={cn('grid aspect-square place-items-center border', preview.surface)}>
              <img
                src={colorway[preview.format]}
                alt={`${colorway.name} ${preview.alt}`}
                width={colorway.width}
                height={colorway.height}
                loading="lazy"
                decoding="async"
                className="h-4/5 w-[85%] object-contain sm:w-[65%]"
              />
            </div>
            <figcaption className="pt-2 text-xs text-muted-foreground sm:text-sm">{preview.caption}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}
