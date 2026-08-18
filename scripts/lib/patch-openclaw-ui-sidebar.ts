/**
 * OpenClaw PC desktop sidebar patch (applied to Control UI sources BEFORE vite build):
 * 1. Remove the collapsed "More" section — show every nav route as a flat, larger list.
 * 2. Move the Sessions block to the very top of the sidebar.
 * 3. Add a "Models" item above all nav routes; clicking it bridges to the desktop
 *    shell via `window.parent.postMessage({ type: "openclaw-pc:open-panel", panel: "models" })`.
 * 4. Larger nav items (height 40px, 14px text, 18px icons).
 *
 * Idempotent: safe to run after every download-openclaw / prepare-bundle.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SENTINEL = 'openclaw-pc-sidebar-desktop'

async function patchFile(
  filePath: string,
  label: string,
  replacements: { find: RegExp | string; replace: string; expectCount?: number }[],
): Promise<boolean> {
  let raw = await readFile(filePath, 'utf8')
  if (raw.includes(SENTINEL)) return false
  for (const { find, replace, expectCount } of replacements) {
    const re = find instanceof RegExp ? find : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const matches = raw.match(re)
    if (!matches || (expectCount != null && matches.length !== expectCount)) {
      console.warn(
        `  [patch-sidebar] ${label}: pattern not found${expectCount != null ? ` (expected ${expectCount}, got ${matches?.length ?? 0})` : ''} — layout may have changed; skipping`,
      )
      return false
    }
    raw = raw.replace(re, replace)
  }
  raw = `// ${SENTINEL} v1\n${raw}`
  await writeFile(filePath, raw, 'utf8')
  console.log(`  [patch-sidebar] ${label}: patched`)
  return true
}

export async function applyOpenClawUiSidebarDesktopPatches(uiRoot: string): Promise<void> {
  const srcRoot = join(uiRoot, 'src')
  const components = join(srcRoot, 'components')
  const styles = join(srcRoot, 'styles')
  const locales = join(srcRoot, 'i18n', 'locales')

  // 1. app-sidebar.ts: flat nav (no More section), Sessions on top, Models bridge item.
  await patchFile(
    join(components, 'app-sidebar.ts'),
    'app-sidebar.ts',
    [
      {
        find: /  sidebarMoreRoutes,\n/,
        replace: ``,
        expectCount: 1,
      },
      {
        find: /            <nav class="sidebar-nav" @contextmenu=\$\{this\.openCustomizeMenuFromContext\}>[\s\S]*?\$\{this\.renderSessions\(\)\}/,
        replace: `            \${this.renderSessions()}
            <nav class="sidebar-nav" @contextmenu=\${this.openCustomizeMenuFromContext}>
              \${this.collapsed ? this.renderRoute("chat") : nothing}
              <div class="nav-section__items">
                <button
                  type="button"
                  class="nav-item nav-item--desktop-models"
                  aria-label=\${t("nav.models")}
                  @click=\${this.openDesktopModels}
                >
                  <span class="nav-item__icon" aria-hidden="true">\${icons.cpu}</span>
                  <span class="nav-item__text">\${t("nav.models")}</span>
                </button>
                \${SIDEBAR_NAV_ROUTES.map((routeId) => this.renderRoute(routeId))}
              </div>
            </nav>`,
        expectCount: 1,
      },
      {
        find: /  private renderMoreSection\(\) \{[\s\S]*?\n  \}\n\n/,
        replace: `  `,
        expectCount: 1,
      },
      {
        find: /  private renderChatFallback\(\) \{/,
        replace: `  /** OpenClaw PC: "Models" opens the desktop Models panel (parent window bridge). */
  private readonly openDesktopModels = () => {
    try {
      window.parent.postMessage({ type: "openclaw-pc:open-panel", panel: "models" }, "*");
    } catch {
      // ignored
    }
  };

  private renderChatFallback() {`,
        expectCount: 1,
      },
    ],
  )

  // 2. icons.ts: add a CPU icon for the Models nav item.
  await patchFile(
    join(components, 'icons.ts'),
    'icons.ts',
    [
      {
        find: /\n\} as const;/,
        replace: `
  cpu: html\`
    <svg viewBox="0 0 24 24">
      <rect width="16" height="16" x="4" y="4" rx="2" />
      <rect width="6" height="6" x="9" y="9" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
    </svg>
  \`,
} as const;`,
        expectCount: 1,
      },
    ],
  )
  await patchFile(
    join(locales, 'en.ts'),
    'en.ts',
    [{ find: /    more: "More",/, replace: `    more: "More",\n    models: "Models",`, expectCount: 1 }],
  )
  await patchFile(
    join(locales, 'ru.ts'),
    'ru.ts',
    [{ find: /    more: "Ещё",/, replace: `    more: "Ещё",\n    models: "Модели",`, expectCount: 1 }],
  )

  // 4. layout.css: bigger nav items.
  await patchFile(
    join(styles, 'layout.css'),
    'layout.css',
    [
      {
        find: /\.nav-item \{\n  position: relative;\n  display: flex;\n  align-items: center;\n  justify-content: flex-start;\n  gap: 8px;\n  min-height: 32px;\n  padding: 0 9px;/,
        replace: `.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  min-height: 40px;
  padding: 0 12px;`,
        expectCount: 1,
      },
      {
        find: /\.nav-item__icon \{\n  width: 16px;\n  height: 16px;/,
        replace: `.nav-item__icon {
  width: 18px;
  height: 18px;`,
        expectCount: 1,
      },
      {
        find: /\.nav-item__icon svg \{\n  width: 16px;\n  height: 16px;/,
        replace: `.nav-item__icon svg {
  width: 18px;
  height: 18px;`,
        expectCount: 1,
      },
      {
        find: /\.nav-item__text \{\n  font-size: 13px;/,
        replace: `.nav-item__text {
  font-size: 14px;`,
        expectCount: 1,
      },
    ],
  )
}
