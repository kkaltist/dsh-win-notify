/**
 * 回调通道：卡片（一支独立的 PowerShell 进程）把用户的操作 POST 回来。
 *
 * 为什么要自己开一个 HTTP 口，而不是挂到 DSH 的 webServer 上：
 * DSH 的 webServer 有它自己的浏览器鉴权（cookie + 每次启动的 token），
 * 卡片不是浏览器，拿不到那套凭证；而这条通道只跑在 127.0.0.1 上、
 * 端口随机、路径里带一次性密钥，泄露面只有本机。
 */
import http from 'node:http'
import { randomUUID } from 'node:crypto'

const MAX_BODY = 64 * 1024

/** @param {{onMessage: (message: any) => void, logger?: {warn: Function}}} options */
export async function startIpc(options) {
  const secret = randomUUID().replace(/-/g, '')
  const onMessage = options.onMessage
  const warn = options.logger?.warn?.bind(options.logger) ?? (() => {})

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const reply = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      reply(200, { ok: true })
      return
    }

    if (url.pathname !== `/reply/${secret}`) {
      reply(404, { ok: false })
      return
    }
    if (req.method !== 'POST') {
      reply(405, { ok: false })
      return
    }

    /** @type {Buffer[]} */
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reply(413, { ok: false })
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > MAX_BODY) return
      let message
      try {
        message = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        reply(400, { ok: false, error: 'bad json' })
        return
      }
      try {
        onMessage(message)
        reply(200, { ok: true })
      } catch (error) {
        warn(`[win-notify] 处理卡片回调失败: ${error instanceof Error ? error.message : String(error)}`)
        reply(500, { ok: false })
      }
    })
    req.on('error', () => { /* 卡片提前退出，忽略 */ })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port

  return {
    secret,
    base: `http://127.0.0.1:${port}`,
    close() {
      server.close()
    },
  }
}
