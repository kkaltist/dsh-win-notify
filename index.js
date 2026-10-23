/**
 * DSH 桌面通知（dsh-win-notify）—— 把「需要你」的时刻推到 Windows 通知中心。
 *
 * 三个入口：
 *   · 任务完成（turn/end）               → 通知正文是模型这轮的回答，带输入框可直接回话
 *   · 需要授权（approval/request）         → 「允许一次 / 拒绝」
 *   · 模型提问（user-questions/request）   → 选项按钮（点空白/正文 → 打开 DSH 页面）
 *
 * 交互怎么回来：通知上的按钮和输入框点击后，Windows 会拉起我们注册的 dsh-notify:// 协议
 * （assets/activate.ps1），它把动作 POST 到本进程起的 127.0.0.1 回路（lib/ipc.js）。
 *
 * 设置入口：本文件导出的 Config 会被 DSH 的设置页渲染成表单
 * （设置 → 插件 → DSH 桌面通知），提示音在那里选，不用改 YAML。
 */
import { spawn, execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startIpc } from './lib/ipc.js'
import { createToastHost } from './lib/toast.js'
import { Config, resolveSound } from './lib/config.js'
import { blocksToText, noticeText, oneLine, clockOf } from './lib/text.js'

export { Config }

export const name = 'win-notify'

/** 不依赖服务：拿不到 webServer 也能跑，DSH 地址只是退化成默认值。 */
export const inject = []

const HERE = path.dirname(fileURLToPath(import.meta.url))

function makeLogger(ctx) {
  try {
    const logger = ctx.logger('win-notify')
    return {
      info: (...args) => logger.info(...args),
      warn: (...args) => logger.warn(...args),
    }
  } catch {
    return {
      info: (...args) => console.log('[win-notify]', ...args),
      warn: (...args) => console.warn('[win-notify]', ...args),
    }
  }
}

export function apply(ctx, config) {
  if (process.platform !== 'win32') return

  const cfg = config ?? {}
  const logger = makeLogger(ctx)

  /** @type {Map<string, any>} sessionId → agent */
  const agents = new Map()
  /** @type {Map<string, {lastAssistant: string, lastUser: string}>} */
  const rolling = new Map()
  /** @type {Map<string, {settle: (value: any) => void}>} 通知 id → 等答案的 promise */
  const waiting = new Map()

  let toastHost = null
  let ipc = null
  let disposed = false

  const ready = (async () => {
    ipc = await startIpc({ onMessage: handleMessage, logger })
    toastHost = createToastHost({
      cfg,
      scriptPath: path.join(HERE, 'assets', 'toast.ps1'),
      port: new URL(ipc.base).port,
      secret: ipc.secret,
      logger,
    })
    ensureRegistered()
  })().catch((error) => {
    logger.warn(`初始化失败，通知不可用：${error instanceof Error ? error.message : String(error)}`)
  })

  /** 通知身份与 dsh-notify:// 协议：每次启动补一次，幂等（改了目录也能自愈）。 */
  function ensureRegistered() {
    const script = path.join(HERE, 'assets', 'register.ps1')
    if (!existsSync(script)) return
    execFile(cfg.powershell ?? 'powershell.exe', [
      '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
      '-File', script,
      '-Activate', path.join(HERE, 'assets', 'activate.ps1'),
      '-Aumid', cfg.aumid,
      '-DisplayName', cfg.appName,
    ], { windowsHide: true, timeout: 30_000 }, (error) => {
      if (error) logger.warn(`注册通知身份失败：${error.message}`)
    })
  }

  function dshUrl() {
    if (cfg.dshUrl) return cfg.dshUrl
    try {
      return `${ctx.webServer.getOrigin()}/`
    } catch {
      return 'http://127.0.0.1:3080/'
    }
  }

  /** 通知被点/被答：动作从 dsh-notify:// 协议绕回来。 */
  function handleMessage(message) {
    if (!message || typeof message !== 'object') return
    const id = String(message.id ?? '')
    if (id === '') return
    const entry = waiting.get(id)
    if (!entry) return
    waiting.delete(id)

    const action = String(message.action ?? '')
    if (action === 'option') {
      const values = Array.isArray(message.values) && message.values.length > 0
        ? message.values.map((item) => String(item))
        : undefined
      entry.settle({ kind: 'option', value: String(message.value ?? ''), values })
      return
    }
    if (action === 'reply') {
      entry.settle({ kind: 'reply', text: String(message.text ?? '') })
      return
    }
    // open / dismiss / timeout：没有答案
    entry.settle(null)
  }

  /**
   * 发一条通知，并把「用户在上面做了什么」变成一个 promise（没作答 → null）。
   * @returns {Promise<{id: string, result: Promise<any>} | null>}
   */
  async function notify(spec) {
    await ready
    if (disposed || !toastHost) return null

    const id = randomUUID()
    const openUrl = dshUrl()
    const focusTitles = Array.isArray(cfg.focusTitles) && cfg.focusTitles.length > 0 ? cfg.focusTitles : ['DeepSeek Harness']
    const titles = focusTitles.join('|')
    const sound = resolveSound(cfg.sounds?.[spec.soundKind], cfg.soundDir ?? '')

    toastHost.show({
      id,
      title: cfg.appName,
      subtitle: spec.kicker,
      body: spec.body,
      // 人就在 DSH 前面就不打扰（判断放在 toast.ps1 里，省一次进程启动）
      skipWhenFocused: cfg.skipWhenFocused,
      focusTitles,
      // 点正文/空白 → 先切到已经开着的 DSH 页面，找不到才新开
      launchUri: toastHost.uri(id, 'open', { u: openUrl, f: titles }),
      tag: 'dsh',
      group: 'dsh',
      actions: (spec.actions ?? []).map((action) => ({
        content: action.content,
        uri: toastHost.uri(id, 'option', { v: action.value, u: openUrl, f: titles }),
      })),
      input: spec.input
        ? {
          placeholder: spec.input.placeholder,
          button: spec.input.button,
          uri: toastHost.uri(id, 'reply', { t: '{reply}', u: openUrl, f: titles }),
        }
        : null,
      audio: toastHost.audioSrc(sound),
    })

    const result = new Promise((resolve) => {
      waiting.set(id, { settle: resolve })
    })
    return { id, result }
  }

  /** 没人再等这条通知了：清掉等待项（toast 本身由系统管，不用我们关）。 */
  function forget(id) {
    const entry = waiting.get(id)
    if (!entry) return
    waiting.delete(id)
    entry.settle(null)
  }

  /** 与 codex 的 notify 同构：['程序','参数'...] + JSON。不等它，不影响主流程。 */
  function runNotify(payload) {
    if (!Array.isArray(cfg.notify) || cfg.notify.length === 0) return
    const [command, ...args] = cfg.notify
    try {
      const child = spawn(command, [...args, JSON.stringify(payload)], {
        windowsHide: true,
        stdio: 'ignore',
        detached: false,
      })
      child.on('error', (error) => logger.warn(`notify 程序起不来：${error.message}`))
      child.unref?.()
    } catch (error) {
      logger.warn(`notify 调用失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ── 会话状态 ──────────────────────────────────────────────────────────
  ctx.on('agent/created', (payload) => {
    const agent = payload?.agent
    if (agent?.session?.id) agents.set(String(agent.session.id), agent)
  })

  ctx.on('agent/disposed', (payload) => {
    const agent = payload?.agent
    if (agent?.session?.id) agents.delete(String(agent.session.id))
  })

  ctx.on('session/event', (session, event) => {
    if (disposed || !session || !event) return
    const sessionId = String(session.id)
    const state = rolling.get(sessionId) ?? { lastAssistant: '', lastUser: '' }

    if (event.type === 'user/message') {
      const text = blocksToText(event.data?.content)
      if (text !== '') state.lastUser = text
      rolling.set(sessionId, state)
      return
    }
    if (event.type === 'assistant/message') {
      const text = blocksToText(event.data?.message?.content)
      if (text !== '') state.lastAssistant = text
      rolling.set(sessionId, state)
      return
    }
    if (event.type === 'turn/end') handleTurnEnd(session, event, state)
  })

  function handleTurnEnd(session, event, state) {
    if (!cfg.onTurnEnd) return
    if (session.header?.origin === 'subagent') return

    const reason = event.data?.reason?.kind ?? 'completed'
    if (reason !== 'completed' && reason !== 'error') return

    const answer = state.lastAssistant
    if (reason === 'completed' && answer.trim() === '') return

    const turn = Number(event.data?.turn ?? 0)
    const failed = reason === 'error'
    const failure = failed ? String(event.data?.reason?.error?.message ?? '模型请求失败') : ''
    const prompt = oneLine(state.lastUser, 64)

    runNotify({
      type: failed ? 'agent-turn-error' : 'agent-turn-complete',
      'turn-id': `${String(session.id)}:${turn}`,
      'session-id': String(session.id),
      'input-messages': prompt === '' ? [] : [prompt],
      'last-assistant-message': answer,
    })

    notify({
      soundKind: 'turnEnd',
      kicker: `${failed ? '任务出错' : '任务完成'} · ${clockOf()} · 第 ${turn} 轮`,
      body: failed ? noticeText(`${failure}\n\n${answer}`) : noticeText(answer),
      input: cfg.interactive ? { placeholder: '回复 DeepSeek Harness', button: '发送' } : null,
    }).then(async (notice) => {
      if (!notice) return
      const action = await notice.result
      if (!action || action.kind !== 'reply') return
      const text = String(action.text ?? '').trim()
      if (text !== '') sendReply(String(session.id), text)
    }).catch((error) => {
      logger.warn(`完成通知出错：${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /** 通知里打的字 = 一条普通用户消息（agent.followup，等价于在输入框回车）。 */
  async function sendReply(sessionId, text) {
    const agent = agents.get(sessionId)
    if (!agent) {
      logger.warn('会话已不在运行，回复没有送出去')
      return
    }
    try {
      const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
      agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
    } catch (error) {
      logger.warn(`回复没能送进会话：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ── 授权 ──────────────────────────────────────────────────────────────
  ctx.on('approval/request', async (request, next) => {
    if (disposed) return next()
    const downstream = next()

    runNotify({
      type: 'approval-requested',
      'session-id': String(request?.agent?.session?.id ?? ''),
      'tool-name': String(request?.toolName ?? ''),
      reason: String(request?.reason ?? ''),
    })

    if (!cfg.onApproval) return downstream

    const toolName = String(request?.toolName ?? '工具')
    const reason = String(request?.reason ?? '').trim()
    const options = cfg.interactive
      ? [{ label: '允许一次', value: 'allowed-once' }, { label: '拒绝', value: 'rejected' }]
      : []

    const notice = await notify({
      soundKind: 'approval',
      kicker: `需要授权 · ${clockOf()}`,
      body: noticeText(reason === ''
        ? `${toolName} 请求执行一次需要授权的操作。`
        : `${toolName} 请求执行一次需要授权的操作。\n\n${reason}`, 420),
      actions: options,
    })
    if (!notice) return downstream

    return race(notice, downstream, (value) => {
      if (!value || value.kind !== 'option') return undefined
      if (value.value === 'allowed-once' || value.value === 'rejected') return value.value
      return undefined
    })
  })

  // ── 模型提问 ──────────────────────────────────────────────────────────
  ctx.on('user-questions/request', async (request, next) => {
    if (disposed) return next()
    const downstream = next()

    const questions = Array.isArray(request?.questions) ? request.questions : []
    const first = questions[0]

    runNotify({
      type: 'question-requested',
      'session-id': String(request?.agent?.session?.id ?? ''),
      questions: questions.map((item) => ({ id: String(item.id), question: String(item.question) })),
    })

    if (!cfg.onQuestion || !first) return downstream

    // 一次问多题时只做提醒：答案必须一次给全，缺一个就是非法批次
    const single = questions.length === 1
    const labels = cfg.interactive && single && Array.isArray(first.options) && first.options.length > 0
      ? first.options.map((option) => String(option.label)).slice(0, 3)
      : []
    const detail = first.detail ? `\n\n${String(first.detail)}` : ''
    const more = single ? '' : `\n\n（共 ${questions.length} 个问题，请回到 DSH 一次答完）`

    const notice = await notify({
      soundKind: 'question',
      kicker: `需要你回答 · ${clockOf()}`,
      body: noticeText(`${String(first.question)}${detail}${more}`, 420),
      actions: labels.map((label) => ({ content: label, value: label })),
      input: cfg.interactive && single && labels.length === 0
        ? { placeholder: '输入你的回答', button: '发送' }
        : null,
    })
    if (!notice) return downstream

    return race(notice, downstream, (value) => {
      if (!value) return undefined
      if (value.kind === 'reply') {
        const text = String(value.text ?? '').trim()
        if (text === '') return undefined
        return { answers: [{ id: String(first.id), selected: [], custom: text }] }
      }
      if (value.kind === 'option') {
        const selected = Array.isArray(value.values) && value.values.length > 0
          ? value.values.map((item) => String(item))
          : [String(value.value ?? '')].filter((item) => item !== '')
        if (selected.length === 0) return undefined
        return { answers: [{ id: String(first.id), selected }] }
      }
      return undefined
    })
  })

  /**
   * 通知与浏览器同时等答案，谁先给出有效答案算谁的。
   * 通知被关掉 / 超时（null）不算答案，继续等浏览器那边。
   */
  async function race(notice, downstream, mapValue) {
    const winner = await new Promise((resolve) => {
      let settled = false
      notice.result.then((value) => {
        const mapped = value ? mapValue(value) : undefined
        if (settled || mapped === undefined) return
        settled = true
        resolve({ from: 'notice', value: mapped })
      }).catch(() => { /* 通知侧出错就让浏览器兜底 */ })
      downstream.then((value) => {
        if (settled) return
        settled = true
        resolve({ from: 'ui', value })
      }, (error) => {
        if (settled) return
        settled = true
        resolve({ from: 'ui', error })
      })
    })

    forget(notice.id)
    if (winner.error) throw winner.error
    return winner.value
  }

  ctx.effect(() => () => {
    disposed = true
    for (const id of [...waiting.keys()]) forget(id)
    try { ipc?.close() } catch { /* 已经关了 */ }
  })
}
