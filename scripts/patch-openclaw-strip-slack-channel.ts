/**
 * OpenClaw upstream hardcodes `slack` in `CHAT_CHANNEL_ORDER` inside the compiled
 * `dist/chat-meta-*.js` chunk. When the Slack extension is stripped (because `@slack/web-api`
 * is not in the published npm tarball), the startup check throws:
 *
 *   `Missing bundled chat channel metadata for: slack`
 *
 * This patch removes `slack` from the hardcoded order array so the bundle works
 * without the Slack extension or its runtime dependency.
 *
 * Additionally, `slack-surface-*.js` delegates all function calls through a facade loader
 * to `slack/api.js`. When that surface is stripped, the facade throws on the first call.
 * We replace `slack-surface-*.js` with stub no-op exports so the HTTP stage for Slack
 * fails silently (the gateway's `runGatewayHttpRequestStages` already handles `.catch`
 * and skips the stage).
 *
 * Idempotent: safe to run after every download-openclaw / prepare-bundle.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

/**
 * The export names used by `slack-surface-*.js` and imported by `gateway-cli-*.js`.
 * Each is replaced by a safe no-op: numbers return 0, lists return [], actions return null/undefined.
 * handleSlackHttpRequest returns false so the gateway continues to the next stage without
 * sending a response (prevents ERR_HTTP_HEADERS_SENT in subsequent stages).
 */
const NOOP_SURFACE = `
// /* openclaw-pc: slack stripped — no-op surface (extension removed from bundle) */
const buildSlackThreadingToolContext=()=>{};
const createSlackWebClient=()=>({});
const deleteSlackMessage=async()=>null;
const downloadSlackFile=async()=>null;
const editSlackMessage=async()=>null;
const extractSlackToolSend=()=>{};
const getSlackMemberInfo=async()=>null;
function handleSlackHttpRequest(){return false;}
const inspectSlackAccount=async()=>null;
const isSlackInteractiveRepliesEnabled=()=>false;
const listEnabledSlackAccounts=async()=>[];
const listSlackAccountIds=async()=>[];
const listSlackDirectoryGroupsFromConfig=async()=>[];
const listSlackDirectoryPeersFromConfig=async()=>[];
const listSlackEmojis=async()=>[];
const listSlackMessageActions=async()=>[];
const listSlackPins=async()=>[];
const listSlackReactions=async()=>[];
const normalizeAllowListLower=(v)=>v??[];
const parseSlackBlocksInput=async()=>null;
const recordSlackThreadParticipation=async()=>{};
const resolveDefaultSlackAccountId=async()=>null;
const resolveSlackAutoThreadId=()=>null;
const resolveSlackGroupRequireMention=()=>false;
const resolveSlackRuntimeGroupPolicy=()=>({});
const resolveSlackGroupToolPolicy=()=>({});
const resolveSlackReplyToMode=()=>"off";
const sendSlackMessage=async()=>null;
const pinSlackMessage=async()=>null;
const reactSlackMessage=async()=>null;
const readSlackMessages=async()=>[];
const removeOwnSlackReactions=async()=>null;
const removeSlackReaction=async()=>null;
const unpinSlackMessage=async()=>null;
export{resolveSlackGroupToolPolicy as A,readSlackMessages as C,resolveDefaultSlackAccountId as D,removeSlackReaction as E,resolveSlackRuntimeGroupPolicy as M,sendSlackMessage as N,resolveSlackAutoThreadId as O,unpinSlackMessage as P,reactSlackMessage as S,removeOwnSlackReactions as T,listSlackPins as _,editSlackMessage as a,parseSlackBlocksInput as b,handleSlackHttpRequest as c,listEnabledSlackAccounts as d,listSlackAccountIds as f,listSlackMessageActions as g,listSlackEmojis as h,downloadSlackFile as i,resolveSlackReplyToMode as j,resolveSlackGroupRequireMention as k,inspectSlackAccount as l,listSlackDirectoryPeersFromConfig as m,createSlackWebClient as n,extractSlackToolSend as o,listSlackDirectoryGroupsFromConfig as p,deleteSlackMessage as r,getSlackMemberInfo as s,buildSlackThreadingToolContext as t,isSlackInteractiveRepliesEnabled as u,listSlackReactions as v,recordSlackThreadParticipation as w,pinSlackMessage as x,normalizeAllowListLower as y};
`.trimStart()

export async function patchOpenClawStripSlackChannel(openclawRoot: string): Promise<void> {
  const dist = join(openclawRoot, 'dist')
  let names: string[]
  try {
    names = await readdir(dist)
  } catch {
    return
  }

  // Hashed output file name varies per build — CHAT_CHANNEL_ORDER has moved between
  // chat-meta-*.js and channel-options-*.js across upstream versions; match both.
  const candidatePaths = names
    .filter((n) => /^chat-meta-.*\.js$/.test(n) || /^channel-options-.*\.js$/.test(n))
    .map((n) => join(dist, n))

  if (candidatePaths.length === 0) return

  for (const filePath of candidatePaths) {
    let raw = await readFile(filePath, 'utf8')

    // Skip if already patched
    const patchedMarker = '/* openclaw-pc: slack stripped from channel order */'
    if (raw.includes(patchedMarker)) continue

    // Match the hardcoded CHAT_CHANNEL_ORDER array and remove "slack"
    // Expected: "slack", with surrounding whitespace/newline (minified code)
    const slackEntry = /[\s\n]*"slack",/
    if (!slackEntry.test(raw)) {
      // Also try without trailing comma (in case it's the last element)
      const slackEntryNoComma = /[\s\n]*"slack"\s*\]/
      if (slackEntryNoComma.test(raw)) {
        raw = raw.replace(slackEntryNoComma, '\n]')
      } else {
        console.warn(
          `  [patch-slack] ${basename(filePath)}: CHAT_CHANNEL_ORDER "slack" entry not found — layout may have changed`,
        )
        continue
      }
    } else {
      raw = raw.replace(slackEntry, '')
    }

    // Add idempotent marker so we know this file was patched
    raw = `// ${patchedMarker}\n` + raw
    await writeFile(filePath, raw, 'utf8')
    console.log(`  [patch-slack] ${basename(filePath)}: "slack" removed from CHAT_CHANNEL_ORDER`)
  }

  // Patch slack-surface-*.js: replace facade-loader stubs with inline no-ops so the
  // gateway HTTP stage for Slack skips gracefully instead of throwing on the stripped extension.
  const surfacePaths = names
    .filter((n) => /^slack-surface-.*\.js$/.test(n))
    .map((n) => join(dist, n))

  for (const filePath of surfacePaths) {
    const existing = await readFile(filePath, 'utf8')
    if (existing.includes('slack stripped — no-op surface')) continue
    await writeFile(filePath, NOOP_SURFACE, 'utf8')
    console.log(`  [patch-slack] ${basename(filePath)}: replaced with no-op surface`)
  }
}
