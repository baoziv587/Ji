/**
 * The 极 seal, stamped in cinnabar with the glyph cut out (白文). The same
 * impression reads on ink and on paper, so both themes share one image.
 */
export function Seal({ size, alt }: { size: number; alt: string }) {
  return <img src="/seal.svg" width={size} height={size} alt={alt} className="block rounded-[3px]" />
}
