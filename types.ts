// 前后端共享的类型定义，接口两侧都用同一份，避免字段对不上

/** 一个 STT 服务商的配置，后端拿它拼出真实的转写请求 */
export type Provider = {
  id: string // 唯一 id，由前端用 crypto.randomUUID 生成
  name: string // 显示名，如 "Groq Whisper"
  baseURL: string // OpenAI 兼容接口的根地址，如 https://api.groq.com/openai/v1
  apiKey: string // 鉴权 key，只存在本机 data/db.json，不会进入前端代码
  model: string // 模型名，如 whisper-large-v3
}

/** 一条已保存到磁盘的录音的元数据 */
export type Recording = {
  id: string // 唯一 id，同时也是磁盘上的音频文件名
  name: string // 显示名，按创建顺序自动编号
  durationMs: number // 录音时长，单位毫秒
  createdAt: string // 创建时间，ISO 字符串
}

/** 一次成功识别的结果 */
export type Transcript = {
  text: string // 识别出来的文字
  durationMs: number // 这次请求本身花了多少毫秒
  at: string // 完成时间，ISO 字符串
}

/** 识别结果矩阵：results[providerId][recordingId]，两个维度都能直接取到某一次组合的结果 */
export type Results = Record<string, Record<string, Transcript>>

/** GET /api/state 一次返回的全部数据 */
export type AppState = {
  providers: Provider[]
  recordings: Recording[]
  results: Results
}
