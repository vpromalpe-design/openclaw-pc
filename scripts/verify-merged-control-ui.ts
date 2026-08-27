/**
 * CI: after merging Linux-built Control UI into build/openclaw/dist/control-ui, verify refs + JS syntax.
 * Usage: pnpm exec tsx scripts/verify-merged-control-ui.ts [path]
 */

import { verifyControlUiBundle } from './lib/control-ui-verify.ts'
import { join } from 'node:path'

const root = process.argv[2]?.trim() || join(process.cwd(), 'build', 'openclaw', 'dist', 'control-ui')

await verifyControlUiBundle(root)
console.log(`  [ok] merged control-ui: ${root}`)
