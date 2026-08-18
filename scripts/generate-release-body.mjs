#!/usr/bin/env node
/**
 * Generates the GitHub Release body from CHANGELOG.md.
 *
 * Body layout:
 *   - "What's new" section: the full changelog section of the release version
 *   - "Version history" table: every previous version with a short summary
 *
 * Usage:
 *   node scripts/generate-release-body.mjs --version 0.8.7 [--changelog CHANGELOG.md] [--out body.md]
 *   (without --out the body is printed to stdout)
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function parseArgs(argv) {
  const args = { version: null, changelog: 'CHANGELOG.md', out: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--version') args.version = argv[++i]
    else if (a === '--changelog') args.changelog = argv[++i]
    else if (a === '--out') args.out = argv[++i]
  }
  return args
}

/** Split changelog into sections: [{ version, date, body }] in file order. */
function parseChangelog(text) {
  const sections = []
  const re = /^## \[([^\]]+)\] - ([^\n]+)$/gm
  let m
  const headers = []
  while ((m = re.exec(text)) !== null) {
    headers.push({ version: m[1].trim(), date: m[2].trim(), headerStart: m.index, bodyStart: m.index + m[0].length })
  }
  for (let i = 0; i < headers.length; i++) {
    const end = i + 1 < headers.length ? headers[i + 1].headerStart : text.length
    sections.push({
      version: headers[i].version,
      date: headers[i].date,
      body: text.slice(headers[i].bodyStart, end).trim(),
    })
  }
  return sections
}

/** Short one-line summary: first up to 3 bullets, cleaned and truncated. */
function summarize(body, maxBullets = 3, maxLen = 140) {
  const bullets = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) =>
      l
        .replace(/^- /, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .trim(),
    )
    .filter(Boolean)
  if (bullets.length === 0) return '—'
  const parts = bullets.slice(0, maxBullets).map((b) => (b.length > maxLen ? b.slice(0, maxLen - 1) + '…' : b))
  return parts.join('; ')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.version) {
    console.error('error: --version is required (e.g. 0.8.7)')
    process.exit(1)
  }
  const changelog = await readFile(resolve(args.changelog), 'utf8')
  const sections = parseChangelog(changelog)

  const current = sections.find((s) => s.version === args.version)
  if (!current) {
    console.error(`error: version ${args.version} not found in ${args.changelog}`)
    process.exit(1)
  }

  const lines = []
  lines.push(`## OpenClaw Desktop ${args.version}`)
  lines.push('')
  lines.push(`**Дата выпуска:** ${current.date}`)
  lines.push('')
  lines.push(`### Что нового в ${args.version}`)
  lines.push('')
  lines.push(current.body)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('### История версий')
  lines.push('')
  lines.push('| Версия | Дата | Основные изменения |')
  lines.push('| --- | --- | --- |')
  for (const s of sections) {
    if (s.version === args.version || s.version === 'Unreleased') continue
    lines.push(`| ${s.version} | ${s.date} | ${summarize(s.body).replace(/\|/g, '\\|')} |`)
  }
  lines.push('')
  lines.push('Полный список изменений — в [CHANGELOG.md](https://github.com/vpromalpe-design/openclaw-desktop/blob/main/CHANGELOG.md).')
  lines.push('')
  const body = lines.join('\n')

  if (args.out) {
    await writeFile(resolve(args.out), body, 'utf8')
    console.log(`release body written to ${args.out} (${body.length} bytes)`)
  } else {
    process.stdout.write(body)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
