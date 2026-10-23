/**
 * 离线冒烟：不启 DSH，用假 ctx 调 apply()，伪造一条 turn/end 与一次授权请求，
 * 确认监听器挂上、Config 表单能生成、通知能发出去（不等到人点）。
 *
 *   node scripts/smoke.mjs
 */
import { apply, Config } from '../index.js'

const listeners = new Map()

const ctx = {
  logger: () => ({ info: () => {}, warn: (...args) => console.log('[warn]', ...args) }),
  on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, [])
    listeners.get(event).push(handler)
    return () => {}
  },
  effect(factory) {
    factory()
    return () => {}
  },
  webServer: { getOrigin: () => 'http://127.0.0.1:3080' },
}

// 1) 设置表单：默认值 → 校验一遍
const defaults = Config({})
console.log('[smoke] 设置表单默认值:', JSON.stringify(defaults))

apply(ctx, defaults)

function emit(event, ...args) {
  const list = listeners.get(event) ?? []
  return Promise.all(list.map((handler) => handler(...args)))
}

const session = { id: 'smoke-session', header: {} }
emit('agent/created', { agent: { session, followup: () => {} } })
await emit('session/event', session, {
  type: 'user/message',
  data: { content: [{ type: 'text', text: '把 dsh-bilibili 的转写脚本改成并发下载' }] },
})
await emit('session/event', session, {
  type: 'assistant/message',
  data: { message: { content: [{ type: 'text', text: '改完了。extractor 现在按 4 路并发拉取字幕与封面，失败重试 2 次。' }] } },
})
await emit('session/event', session, {
  type: 'turn/end',
  data: { turn: 3, reason: { kind: 'completed' } },
})

console.log('[smoke] 监听器:', [...listeners.keys()].join(', '))
console.log('[smoke] 已触发 turn/end')

setTimeout(() => {
  console.log('[smoke] ok')
  process.exit(0)
}, 3000)
