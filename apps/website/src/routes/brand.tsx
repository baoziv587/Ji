import { createFileRoute, Link } from '@tanstack/react-router'
import { ColorwaySection } from '~/components/colorway-section'
import { LogoHop } from '~/components/logo-hop'
import { SilkSection } from '~/components/silk-section'
import { colorways } from '~/lib/catalog'

export const Route = createFileRoute('/brand')({
  head: () => ({
    meta: [{ title: 'JI · Brand assets' }],
  }),
  component: Brand,
})

function Brand() {
  return (
    <div className="theme-paper min-h-dvh bg-background text-foreground">
      <main className="mx-auto max-w-[1100px] px-4 py-8 font-[system-ui] sm:px-6 sm:py-16">
        <Link to="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ji.dev
        </Link>
        <header className="mt-6">
          <h1 className="mb-3 text-3xl font-semibold tracking-tight sm:text-5xl">JI · Logo assets</h1>
          <p className="max-w-[650px] text-muted-foreground">
            {colorways.length} 种配色，同一裁切范围。SVG 为纯矢量，WebP
            为无损透明图。全部仅保留图形，已移除纸底和底部文字。下方背景仅用于预览。
          </p>
          <LogoHop ground="paper" className="mt-10" />
        </header>
        {colorways.map(colorway => (
          <ColorwaySection key={colorway.id} colorway={colorway} />
        ))}
        <SilkSection />
        <footer className="pt-6 text-sm text-muted-foreground">
          SVG 保留蚀刻纹理，每版约 2 MB；网页展示优先使用约 330 KB 的
          WebP。图形内部的刻痕也透明，会透出当前页面底色。纸白拓片版专为墨色底设计。矢量化细节与原始位图存在差异。
        </footer>
      </main>
    </div>
  )
}
