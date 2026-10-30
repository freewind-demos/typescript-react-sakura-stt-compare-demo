// 存储层：结构化数据全放 data/db.json，音频二进制放 data/recordings/，进程内只缓存一份
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises' // 只需要这几个文件操作
import path from 'node:path' // 拼路径
import type { AppState, Provider, Recording, Transcript } from '../types.ts' // 共享类型

// 数据目录固定在「运行目录/data」，README 里要求必须在项目根启动
const DATA_DIR = path.resolve(process.cwd(), 'data')
// 音频子目录，一条录音一个文件
const AUDIO_DIR = path.join(DATA_DIR, 'recordings')
// 全部结构化数据的落盘位置
const DB_FILE = path.join(DATA_DIR, 'db.json')

// 内存中的全量数据，启动时从磁盘读一次，之后每次改动都同步写回
let db: AppState = { providers: [], recordings: [], results: {} }

// 串行写盘队列，避免并发请求同时写同一个文件造成内容交错
let writeChain: Promise<void> = Promise.resolve()

/** 保证 data/ 与 data/recordings/ 存在，第一次运行时都还没有 */
async function ensureDirs(): Promise<void> {
  await mkdir(AUDIO_DIR, { recursive: true }) // recursive 会在需要时连带创建父目录
}

/** 启动时加载 db.json；文件不存在或已损坏就退回空数据 */
export async function loadDb(): Promise<void> {
  await ensureDirs() // 先确保目录存在，否则写盘会失败
  try {
    db = JSON.parse(await readFile(DB_FILE, 'utf8')) as AppState // 直接反序列化成同一形状
  } catch {
    db = { providers: [], recordings: [], results: {} } // 首次运行走这里
  }
}

/** 取当前内存中的全量数据，接口层直接返回它即可 */
export function getDb(): AppState {
  return db
}

/** 把内存数据落盘；先序列化成快照，保证每次写的是调用瞬间的内容 */
export function saveDb(): Promise<void> {
  const snapshot = JSON.stringify(db, null, 2) // 缩进 2 格，方便人直接打开看
  writeChain = writeChain.then(() => writeFile(DB_FILE, snapshot)) // 排队写，不并发
  return writeChain
}

/** 全量覆盖 provider 列表；前端负责维护顺序，后端只落盘 */
export async function replaceProviders(list: Provider[]): Promise<Provider[]> {
  // 缺 id 的补一个，其余字段原样保留
  db.providers = list.map((p) => ({ ...p, id: p.id || crypto.randomUUID() }))
  // 被删掉的 provider 名下的结果一并清理，避免 db.json 里堆孤儿数据
  const aliveIds = new Set(db.providers.map((p) => p.id))
  for (const providerId of Object.keys(db.results)) {
    if (!aliveIds.has(providerId)) delete db.results[providerId]
  }
  await saveDb() // 立刻持久化，刷新页面不丢
  return db.providers // 回传补过 id 的版本
}

/** 一条录音在磁盘上的音频路径 */
function audioPath(id: string): string {
  return path.join(AUDIO_DIR, `${id}.webm`) // 扩展名固定 webm，与前端录音格式一致
}

/** 保存一段新录音：音频写文件，元数据进 db.json */
export async function addRecording(audio: Buffer, durationMs: number): Promise<Recording> {
  const recording: Recording = {
    id: crypto.randomUUID(), // 用随机 id，删掉再录不会撞名
    name: `录音 ${db.recordings.length + 1}`, // 按现有条数编号，删完重录会重号但无影响
    durationMs, // 前端计时得到，只用于展示
    createdAt: new Date().toISOString(), // 便于按时间辨认
  }
  await writeFile(audioPath(recording.id), audio) // 音频先落盘，失败就不记账
  db.recordings.push(recording) // 记账
  await saveDb() // 持久化元数据
  return recording
}

/** 读取音频二进制，转写与页面回放都用它 */
export function readAudio(id: string): Promise<Buffer> {
  return readFile(audioPath(id)) // 不存在时抛 ENOENT，由接口层转成 500
}

/** 删除录音：音频文件、元数据、以及它在所有 provider 下的结果一起清掉 */
export async function removeRecording(id: string): Promise<void> {
  await unlink(audioPath(id)).catch(() => {}) // 文件可能已不在，忽略错误
  db.recordings = db.recordings.filter((r) => r.id !== id) // 元数据剔除
  for (const byRecording of Object.values(db.results)) delete byRecording[id] // 结果矩阵同步剔除，避免残留脏数据
  await saveDb() // 持久化
}

/** 调 OpenAI 兼容的 /audio/transcriptions 接口，返回识别文本 */
async function requestTranscription(provider: Provider, audio: Buffer, filename: string): Promise<string> {
  const form = new FormData() // Node 18+ 自带 FormData，不用额外依赖
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/webm' }), filename) // 音频字段，名字带扩展名
  form.append('model', provider.model) // 各家都要求显式指定模型
  const res = await fetch(`${provider.baseURL.replace(/\/+$/, '')}/audio/transcriptions`, {
    method: 'POST', // 各家统一用 POST multipart
    headers: { Authorization: `Bearer ${provider.apiKey}` }, // 统一 Bearer 鉴权
    body: form, // 自动带 multipart 边界
  })
  const body = await res.text() // 先按文本读，出错时能原样带回错误信息
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`) // 截断超长错误
  const data = JSON.parse(body) as { text?: string } // 兼容接口都返回 { text }
  if (typeof data.text !== 'string') throw new Error(`响应缺少 text 字段: ${body.slice(0, 300)}`)
  return data.text // 成功路径
}

/** 让某个 provider 识别某条录音，成功就写进结果矩阵并返回 */
export async function transcribe(providerId: string, recordingId: string): Promise<Transcript> {
  const provider = db.providers.find((p) => p.id === providerId) // 先校验两边都存在
  if (!provider) throw new Error('provider 不存在')
  const recording = db.recordings.find((r) => r.id === recordingId) // 录音同理
  if (!recording) throw new Error('录音不存在')

  const audio = await readAudio(recording.id) // 从磁盘取音频
  const startedAt = Date.now() // 开始计时，用于展示这次请求耗时
  const text = await requestTranscription(provider, audio, `${recording.id}.webm`) // 真正的网络请求
  const transcript: Transcript = {
    text, // 识别文本
    durationMs: Date.now() - startedAt, // 本次耗时
    at: new Date().toISOString(), // 完成时间
  }
  // 结果按 provider → 录音 两级存放，同一组合重跑会覆盖旧结果
  db.results[providerId] = { ...(db.results[providerId] ?? {}), [recordingId]: transcript }
  await saveDb() // 持久化，刷新或重启都还在
  return transcript // 回给前端直接展示
}
