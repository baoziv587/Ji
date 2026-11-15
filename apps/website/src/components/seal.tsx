/**
 * The 极 seal: paper on the ink theme, ink on the paper theme. Only one of the
 * two images is displayed (see .dark-only and .light-only in styles.css).
 */
export function Seal({ size, alt }: { size: number; alt: string }) {
  return (
    <>
      <img src="/seal.svg" width={size} height={size} alt={alt} className="dark-only block rounded-[3px]" />
      <img src="/seal-ink.svg" width={size} height={size} alt={alt} className="light-only block rounded-[3px]" />
    </>
  )
}
