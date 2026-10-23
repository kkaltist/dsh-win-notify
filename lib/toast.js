/**
 * Windows 系统通知（WinRT Toast）通道。
 *
 * 与卡片通道的区别：toast 是系统的东西 —— 会进通知中心、遵守勿扰、跟着系统主题，
 * 长得就跟系统自带的通知一样（也是 ChatGPT 桌面版那种样子的来源）。
 *
 * 代价是交互：toast 上的按钮/输入框点击后，系统只会「用我们注册的 dsh-notify:// 协议
 * 把一句话交回来」。所以按钮的每个取值都编进 URI，输入框的字靠 {reply} 占位符；
 * 系统如果不替换它（部分版本如此），activate.ps1 会把人带回 DSH 页面而不是丢消息。
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** 把一段字符串编进 URI 的 path 段（允许中文、空格）。 */
export function seg(value) {
  return encodeURIComponent(String(value ?? ''))
}

export function createToastHost(options) {
  const { cfg, scriptPath, port, secret, logger } = options

  async function show(payload) {
    const file = path.join(os.tmpdir(), 'dsh-win-notify', `toast-${randomUUID()}.json`)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ aumid: cfg.aumid, ...payload }), 'utf8')
    try {
      const child = spawn(cfg.powershell ?? 'powershell.exe', [
        '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Payload', file,
      ], { windowsHide: true, stdio: 'ignore' })
      child.on('error', (error) => logger.warn(`toast 起不来：${error.message}`))
      child.on('exit', () => { rm(file, { force: true }).catch(() => {}) })
    } catch (error) {
      logger.warn(`toast 发送失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * dsh-notify://<port>/<secret>/<id>/<action>?v=..&t=..&u=..&f=..
   * 自己拼查询串：URLSearchParams 会把空格编成 `+`，而协议那头只按 %20 解。
   */
  function uri(id, action, query = {}) {
    const params = []
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      params.push(`${key}=${encodeURIComponent(String(value))}`)
    }
    const tail = params.join('&')
    return `dsh-notify://${port}/${secret}/${seg(id)}/${action}${tail === '' ? '' : `?${tail}`}`
  }

  /** 提示音 → toast 的 audio src。系统只认 wav/mp3，且不能太长。 */
  function audioSrc(sound) {
    if (!sound || sound === 'none') return { silent: true }
    if (sound === 'default') return { src: 'ms-winsoundevent:Notification.Default' }
    if (sound === 'exclamation') return { src: 'ms-winsoundevent:Notification.Reminder' }
    if (sound === 'urgent') return { src: 'ms-winsoundevent:Notification.Looping.Alarm2' }
    if (path.isAbsolute(sound)) return { src: pathToFileURL(sound).href }
    return { src: 'ms-winsoundevent:Notification.Default' }
  }

  return { show, uri, audioSrc }
}
