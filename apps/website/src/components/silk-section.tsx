import { DownloadLinks } from '~/components/download-links'
import { silk } from '~/lib/catalog'

export function SilkSection() {
  const { base, tileSize } = silk.background
  return (
    <section aria-labelledby="silk" className="border-b py-9">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h2 id="silk" className="text-xl font-semibold">
          {silk.name}
        </h2>
        <DownloadLinks
          label={silk.name}
          files={[
            { text: 'SVG', href: silk.svg },
            { text: '1024px WebP', href: silk.webp },
            { text: '纹理 WebP', href: silk.noise },
          ]}
        />
      </div>
      <figure>
        <div
          className="grid aspect-[4/3] place-items-center border sm:aspect-[2/1]"
          style={{
            backgroundColor: base,
            backgroundImage: `url(${silk.noise})`,
            backgroundSize: `${tileSize}px ${tileSize}px`,
          }}
        >
          <img
            src={silk.webp}
            alt={`JI ${silk.name} Logo，绢本纹理背景`}
            width={silk.width}
            height={silk.height}
            loading="lazy"
            decoding="async"
            className="h-4/5 w-auto object-contain"
          />
        </div>
        <figcaption className="pt-2 text-xs text-muted-foreground sm:text-sm">
          背景由原图纸纹提取、镜像拼接，可无缝平铺；与独立的透明 Logo 组合。
        </figcaption>
      </figure>
    </section>
  )
}
