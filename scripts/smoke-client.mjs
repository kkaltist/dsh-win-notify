/**
 * 浏览器半身的离线自检：不启 DSH，模拟 __ModuleLoader__、react 与 configForms，
 * 确认 client.js 能加载、能把「提示音」那块真的渲染出来（含数据链路）。
 *
 *   node scripts/smoke-client.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(HERE, '..')
const load = (file) => import(`file:///${path.join(root, file).replace(/\\/g, '/')}`)

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      captured = entry
    },
  },
}

/**
 * 最小 react 替身：有状态的 useState + 立即执行的 useEffect，
 * 再用「多渲染几轮」模拟 setState 引起的重渲染。
 */
function makeHooks() {
  const states = []
  let index = 0
  return {
    begin() { index = 0 },
    useState(init) {
      const slot = index++
      if (!(slot in states)) states[slot] = typeof init === 'function' ? init() : init
      return [states[slot], (next) => { states[slot] = typeof next === 'function' ? next(states[slot]) : next }]
    },
    useMemo(fn) { index += 1; return fn() },
    useEffect(fn) { index += 1; fn() },
    createElement: (type, props, ...children) => ({ type, props, children }),
  }
}

const hooks = makeHooks()
await load('client.js')
if (!captured) throw new Error('client.js 没有调用 __ModuleLoader__.load')

const module = captured.factory((name) => {
  if (name !== 'react') throw new Error(`意外的依赖：${name}`)
  return hooks
})
console.log('[client] id:', captured.id, '| name:', module.name, '| inject:', module.inject.join(','))

// ── 假 configForms：镜像要 ensure() 之后才有数据（第一版就是漏了 ensure） ──
const { Config } = await load('lib/config.js')
const schema = JSON.parse(JSON.stringify(Config.toJSON()))
const namespaceRow = {
  ns: 'win-notify',
  schema,
  value: { sounds: { turnEnd: 'default', approval: 'exclamation', question: 'exclamation' }, skipWhenFocused: true },
  writable: true,
  revision: 1,
}
let snapshot = { status: 'idle', view: undefined, error: null }
const listeners = new Set()
const mirror = {
  ensure() {
    if (snapshot.view) return
    snapshot = { status: 'ready', view: { writable: true, namespaces: [namespaceRow] }, error: null }
    for (const listener of listeners) listener()
  },
  getSnapshot: () => snapshot,
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
const writes = []
const form = {
  getSnapshot: () => ({ status: 'ready', value: namespaceRow.value, writable: true, revision: 1 }),
  subscribe: () => () => {},
  mutate: (ops) => { writes.push(ops); return Promise.resolve(true) },
}
const ctx = { configForms: { describe: () => mirror, get: () => form } }

/** 渲染到稳定：最多三轮（effect 里的 setState 靠下一轮生效）。 */
function render(props) {
  let tree = null
  for (let round = 0; round < 3; round += 1) {
    hooks.begin()
    tree = module.__test.SoundSettings(props)
  }
  return tree
}

// 1) 离线加载时镜像还没 ensure → 第一轮必须不崩
hooks.begin()
const empty = module.__test.SoundSettings({ subject: { pkg: { name: 'dsh-win-notify' } }, ctx })
console.log('[client] 首轮（镜像未加载）:', empty === null ? 'null（预期，随后 ensure 拉起来）' : '有内容')

// 2) 稳定渲染后应出现「提示音」
const tree = render({ subject: { pkg: { name: 'dsh-win-notify' } }, ctx })
if (tree === null) throw new Error('ensure 之后仍然没渲染')
console.log('[client] 渲染标题:', tree.children?.[0]?.children)

const selects = []
const checkboxes = []
const walk = (node) => {
  if (!node || typeof node !== 'object') return
  if (node.type === 'select') selects.push(node)
  if (node.type === 'input') checkboxes.push(node)
  for (const child of node.children ?? []) walk(child)
}
walk(tree)
console.log('[client] 下拉框:', selects.length, '| 选项:', selects[0]?.children?.map((o) => o.children?.[0]).join(' / '))
console.log('[client] 勾选框:', checkboxes.length)
if (selects.length !== 3) throw new Error('应该有 3 个下拉框')

// 3) 改选一个音效应触发写回
selects[0].props.onChange({ target: { value: 'none' } })
console.log('[client] 写回动作:', JSON.stringify(writes[0]))
if (!writes[0]?.[0]?.path?.length) throw new Error('写回路径不对')

// 4) 别的插件页不该出现
const other = render({ subject: { pkg: { name: 'dsh-bilibili' } }, ctx })
console.log('[client] 其它插件页:', other === null ? 'null（预期）' : '意外有内容')

console.log('[client] ok')
