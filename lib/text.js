/**
 * 把会话事件里的内容块压成「卡片上能看的一行行字」。
 *
 * 卡片只有 520px 宽，塞不下 markdown，也不该塞：模型回答里的代码块、
 * 表格、链接在通知里只是噪音。这里的原则是**保留可读的句子，丢掉标记**。
 */

/** 取一条消息里所有 text 块拼起来。 */
export function blocksToText(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/**
 * 去 markdown：围栏、行内代码、强调、标题、链接、引用、列表符号。
 * 一行一行做，避免跨行替换把整段吃掉。
 */
export function stripMarkdown(input) {
  const text = String(input ?? '')
  const lines = text.split(/\r?\n/)
  const out = []
  let inFence = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      // 代码块只在卡片上留个痕迹，不搬运内容
      continue
    }
    let next = line
    next = next.replace(/^\s{0,3}#{1,6}\s+/, '')          // 标题
    next = next.replace(/^\s{0,3}>\s?/, '')                // 引用
    next = next.replace(/^\s{0,3}[-*+]\s+/, '· ')          // 无序列表
    next = next.replace(/^\s{0,3}\d+[.)]\s+/, (m) => m)    // 有序列表保留
    next = next.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')   // 图片
    next = next.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')    // 链接
    next = next.replace(/`{1,3}([^`]*)`{1,3}/g, '$1')      // 行内代码
    next = next.replace(/(\*\*|__)(.*?)\1/g, '$2')         // 粗体
    next = next.replace(/(\*|_)(.*?)\1/g, '$2')            // 斜体
    next = next.replace(/~~(.*?)~~/g, '$1')                // 删除线
    next = next.replace(/^\s*[-*_]{3,}\s*$/, '')           // 分割线
    out.push(next)
  }
  return out
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 卡片正文：先去标记，再把长文按上限截断（超了加省略号）。 */
export function noticeText(input, limit = 620) {
  const plain = stripMarkdown(input)
  const text = plain.replace(/[ \t]*\n[ \t]*/g, '\n').trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit).replace(/\s+$/, '')}…`
}

/** 单行摘要：压掉换行，按宽度截断。 */
export function oneLine(input, limit = 90) {
  const text = String(input ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit).replace(/[\s，,。.；;：:、-]+$/, '')}…`
}

/** 从一段话里挑个像"标题"的短句：第一句非空行。 */
export function headline(input, limit = 42) {
  const lines = stripMarkdown(input)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return oneLine(lines[0] ?? '', limit)
}

/** 本地时间 HH:mm。 */
export function clockOf(date = new Date()) {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
