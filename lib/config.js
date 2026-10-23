/**
 * 配置：这份 Schema 有两个作用 ——
 *   1. 插件的设置表单由它生成（DSH 设置 → 插件 → DSH 桌面通知），不用另写界面；
 *   2. 运行时按它校验/补默认值。
 *
 * 提示音的三个选项里，内置值之外会**自动列出 assets/sounds/ 下的 wav / mp3**，
 * 所以放进去一个新音频、重启 DSH，设置里就能直接选到。
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 插件根目录（本文件在 lib/ 下面）。 */
const ROOT = path.dirname(HERE)

/** 内置音效值 → 中文名（设置表单里直接显示）。 */
const BUILTIN = {
  default: '系统通知音',
  exclamation: '系统提醒音',
  none: '静音',
}

/** assets/sounds 里的音频文件名。放在模块加载时扫一次：换文件后重启即可见。 */
export function soundFiles() {
  try {
    return readdirSync(path.join(ROOT, 'assets', 'sounds'))
      .filter((name) => /\.(wav|mp3)$/i.test(name))
      .sort()
  } catch {
    return []
  }
}

function soundSchema(fallback) {
  const files = soundFiles()
  const choices = ['default', 'exclamation', 'none', ...files]
  const shape = Schema.union(choices.map((value) => Schema.const(value).description(BUILTIN[value] ?? value)))
  return shape.default(fallback)
}

export const Config = Schema.object({
  onTurnEnd: Schema.boolean().default(true).description('任务完成时通知'),
  onApproval: Schema.boolean().default(true).description('需要授权时通知'),
  onQuestion: Schema.boolean().default(true).description('模型提问时通知'),
  interactive: Schema.boolean().default(true).description('允许在通知上直接作答（关掉只提醒）'),
  skipWhenFocused: Schema.boolean().default(true).description('DSH 在前台时不弹通知'),

  sounds: Schema.object({
    turnEnd: soundSchema('default').description('任务完成'),
    approval: soundSchema('exclamation').description('需要授权'),
    question: soundSchema('exclamation').description('模型提问'),
  })
    .description('提示音；放新音频到 assets/sounds/ 后重启 DSH 即可出现在选项里')
    .default({}),

  soundDir: Schema.string().default('').description('自定义音效目录（选项里写文件名即可）'),
  dshUrl: Schema.string().default('').description('兜底地址：找不到已打开的页面时才用，留空自动取本机 DSH'),
  focusTitles: Schema.array(Schema.string())
    .default(['DeepSeek Harness'])
    .description('点通知时按窗口标题找已打开的 DSH 页面（包含任一即可），找不到才新开'),
  aumid: Schema.string().default('DeepSeek.Harness').description('系统通知的应用身份（改动后需重新注册）'),
  appName: Schema.string().default('DeepSeek Harness').description('通知里显示的应用名'),

  notify: Schema.array(Schema.string())
    .default([])
    .description('与 codex 的 notify 同构：程序与参数，通知时把 JSON 追加成最后一个参数'),
})

/** 提示音取值 → 可以交给播放端的落点：'none' / 'default' / 'exclamation' / 绝对路径。 */
export function resolveSound(value, soundDir, baseDir = ROOT) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name === '' || name === 'none' || name === 'default' || name === 'exclamation') {
    return name === '' ? 'default' : name
  }
  if (path.isAbsolute(name)) return name
  for (const dir of [soundDir, path.join(baseDir, 'assets', 'sounds')]) {
    if (!dir) continue
    const full = path.join(dir, name)
    try {
      if (readdirSync(dir).includes(path.basename(full))) return full
    } catch { /* 目录不存在就跳过 */ }
  }
  return 'default'
}
