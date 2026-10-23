/**
 * 人工验收：不接 DSH，直接发一条系统通知，看它长什么样、点了会回什么。
 *
 *   node scripts/demo.mjs turn-end|approval|question
 *   DEMO_SOUND=none node scripts/demo.mjs turn-end     # 试静音
 *
 * 通知上做的任何操作都会以 [callback] 打在终端上，5 分钟不操作自动退出。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startIpc } from '../lib/ipc.js'
import { createToastHost } from '../lib/toast.js'
import { Config, resolveSound } from '../lib/config.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const kind = process.argv[2] ?? 'turn-end'

const samples = {
  'turn-end': {
    kicker: '任务完成 · 16:42 · 第 3 轮',
    body: '改完了。extractor 现在按 4 路并发拉取字幕与封面，失败重试 2 次；实测一个 38 分钟的视频从 96 秒降到 27 秒，输出文件格式没变。',
    actions: [],
    input: { placeholder: '回复 DeepSeek Harness', button: '发送' },
  },
  approval: {
    kicker: '需要授权 · 16:42',
    body: 'bash 请求执行一次需要授权的操作。\n\nrm -rf .tmp/build —— 清理上一轮的中间产物（约 240 MB）',
    actions: [
      { content: '允许一次', value: 'allowed-once' },
      { content: '拒绝', value: 'rejected' },
    ],
    input: null,
  },
  question: {
    kicker: '需要你回答 · 16:42',
    body: '这份试卷的 MathJax 要本地化还是走 CDN？',
    actions: [
      { content: '本地化（推荐）', value: '本地化（推荐）' },
      { content: 'CDN', value: 'CDN' },
    ],
    input: null,
  },
}

const sample = samples[kind] ?? samples['turn-end']
const cfg = Config({})
const sound = process.env.DEMO_SOUND ?? cfg.sounds[kind === 'turn-end' ? 'turnEnd' : kind] ?? 'default'

const ipc = await startIpc({
  onMessage(message) {
    if (message.action === 'size') return
    console.log('[callback]', JSON.stringify(message))
    setTimeout(() => { ipc.close(); process.exit(0) }, 200)
  },
})

const toast = createToastHost({
  cfg,
  scriptPath: path.join(HERE, '..', 'assets', 'toast.ps1'),
  port: new URL(ipc.base).port,
  secret: ipc.secret,
  logger: console,
})

await toast.show({
  id: 'demo',
  title: cfg.appName,
  subtitle: sample.kicker,
  body: sample.body,
  launchUri: toast.uri('demo', 'open', { u: 'http://127.0.0.1:3080/', f: cfg.focusTitles.join('|') }),
  tag: 'demo',
  group: 'dsh',
  actions: sample.actions.map((action) => ({
    content: action.content,
    uri: toast.uri('demo', 'option', { v: action.value, u: 'http://127.0.0.1:3080/', f: cfg.focusTitles.join('|') }),
  })),
  input: sample.input
    ? {
      placeholder: sample.input.placeholder,
      button: sample.input.button,
      uri: toast.uri('demo', 'reply', { t: '{reply}', u: 'http://127.0.0.1:3080/', f: cfg.focusTitles.join('|') }),
    }
    : null,
  audio: toast.audioSrc(resolveSound(sound, cfg.soundDir)),
})

console.log('[demo] 已发送', kind, '提示音=', sound)
setTimeout(() => { ipc.close(); process.exit(0) }, 5 * 60 * 1000)
