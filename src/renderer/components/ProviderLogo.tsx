import { useMemo } from 'react'

/**
 * Monochrome provider logos (simple-icons style), bundled as raw SVG strings.
 * Providers without a bundled logo render as an empty gap (per product decision:
 * "оставить пустыми как есть").
 */

// Vite: eager-glob all provider SVGs as raw strings, keyed by file name.
const LOGO_MODULES = import.meta.glob('@/assets/provider-logos/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

function extractSvgBody(svg: string): string {
  // Strip the outer <svg ...> wrapper so the logo inherits currentColor,
  // keeping a uniform monochrome look across providers.
  const m = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/i)
  return m ? m[1] : svg
}

export function ProviderLogo({
  providerId,
  className = 'h-4 w-4 shrink-0',
}: {
  providerId: string
  className?: string
}) {
  const body = useMemo(() => {
    const raw = LOGO_MODULES[`/src/renderer/assets/provider-logos/${providerId}.svg`]
    return raw ? extractSvgBody(raw) : null
  }, [providerId])

  if (!body) {
    // No logo bundled for this provider — render nothing (keeps the gap tiny,
    // the label still aligns thanks to flex layout).
    return <span className={className} aria-hidden="true" />
  }

  return (
    <span
      className={`${className} inline-flex items-center justify-center text-current`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  )
}
