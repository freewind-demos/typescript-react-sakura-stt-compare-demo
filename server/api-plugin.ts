// 接口层：以 Vite 插件形式把 /api/* 挂到 dev server 上，前端与后端共用一个端口
import type { IncomingMessage, ServerResponse } from 'node:http' // 直接用 node 的请求响应对象
import type { Plugin } from 'vite' // Vite 插件类型
import type { Provider } from '../types.ts' // provider 的形状
import { addRecording, getDb, loadDb, readAudio, removeRecording, replaceProviders, transcribe } from './store.ts' // 存储层能力

/** 读取请求体的全部字节，JSON 请求与音频上传都走它 */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [] // 边收边攒
    req.on('data', (chunk: Buffer) => chunks.push(chunk)) // 每收到一片就存起来
    req.on('end', () => resolve(Buffer.concat(chunks))) // 收完拼成一个 Buffer
    req.on('error', reject) // 网络中断直接失败
  })
}

/** 统一以 JSON 返回，前端只按 JSON 解析 */
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data) // 只支持可序列化数据
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }) // 明确字符集，避免中文乱码
  res.end(body) // 一次性写完
}

/** 解析 JSON 请求体，空体返回 undefined */
async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const raw = (await readBody(req)).toString('utf8') // 按 utf8 解码
  return (raw ? JSON.parse(raw) : undefined) as T // 空体不解析
}

/** 处理一个 /api 请求；返回 true 表示已经接管，false 表示没匹配到 */
async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const method = req.method ?? 'GET' // 默认按 GET 处理
  const pathname = url.pathname // 形如 /api/state

  if (pathname === '/api/state' && method === 'GET') {
    sendJson(res, 200, getDb()) // 首屏一次拉全量，省掉多次往返
    return true
  }

  if (pathname === '/api/providers' && method === 'PUT') {
    const list = await readJsonBody<Provider[]>(req) // 前端传全量列表
    sendJson(res, 200, await replaceProviders(list)) // 回传补过 id 的版本
    return true
  }

  if (pathname === '/api/recordings' && method === 'POST') {
    const durationMs = Number(url.searchParams.get('durationMs') ?? 0) // 时长走查询参数，请求体留给音频
    sendJson(res, 200, await addRecording(await readBody(req), durationMs)) // 音频原样收下
    return true
  }

  if (pathname === '/api/transcribe' && method === 'POST') {
    const { providerId, recordingId } = await readJsonBody<{ providerId: string; recordingId: string }>(req) // 只传两个 id
    sendJson(res, 200, await transcribe(providerId, recordingId)) // 真正调外部接口并落盘
    return true
  }

  const audioMatch = pathname.match(/^\/api\/recordings\/([^/]+)\/audio$/) // 录音回放地址
  if (audioMatch && method === 'GET') {
    const audio = await readAudio(audioMatch[1]) // 从磁盘读音频
    res.writeHead(200, { 'Content-Type': 'audio/webm', 'Content-Length': audio.length }) // 让浏览器知道长度，能拖动进度
    res.end(audio) // 直接吐二进制
    return true
  }

  const deleteMatch = pathname.match(/^\/api\/recordings\/([^/]+)$/) // 删除录音
  if (deleteMatch && method === 'DELETE') {
    await removeRecording(deleteMatch[1]) // 音频、元数据、结果一起删
    sendJson(res, 200, { ok: true }) // 前端只要知道成功
    return true
  }

  return false // 交给后续中间件
}

/** Vite 插件：dev server 启动时加载数据，并把 /api 前缀的请求全部接管 */
export function apiPlugin(): Plugin {
  return {
    name: 'stt-compare-api', // 插件名，调试日志里能看到
    async configureServer(server) {
      await loadDb() // 启动即读盘，保证首个请求就能拿到历史数据
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost') // 只解析路径，host 随便给
        if (!url.pathname.startsWith('/api/')) return next() // 非接口请求交给 Vite 自己处理
        handle(req, res, url)
          .then((handled) => {
            if (!handled) sendJson(res, 404, { error: '未知接口' }) // 前缀对但路径不认识
          })
          .catch((err: unknown) => {
            sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }) // 异常统一转成 500 并带原因
          })
      })
    },
  }
}
