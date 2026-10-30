// 前端访问后端 /api 的唯一入口，所有网络细节都收在这里
import type { AppState, Provider, Recording, Transcript } from '../types'

/** 统一请求：非 2xx 时抛出后端给的错误信息，成功则解析 JSON */
async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init) // 同源请求，端口一致，不需要跨域配置
  const text = await res.text() // 先按文本读，失败时也要能看到原因
  if (!res.ok) {
    let message = text // 兜底用原始响应体
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text // 优先用后端约定字段
    } catch {
      // 响应不是 JSON 就保留原文
    }
    throw new Error(message || `HTTP ${res.status}`) // 抛给调用方展示
  }
  return (text ? JSON.parse(text) : undefined) as T // 空响应按 undefined 处理
}

/** GET /api/state：一次拿到 provider、录音与已有结果 */
export function fetchState(): Promise<AppState> {
  return request<AppState>('/api/state')
}

/** PUT /api/providers：全量覆盖 provider 列表 */
export function saveProviders(providers: Provider[]): Promise<Provider[]> {
  return request<Provider[]>('/api/providers', {
    method: 'PUT', // 全量覆盖，语义最直白
    body: JSON.stringify(providers), // 直接传数组
  })
}

/** POST /api/recordings：把录音二进制上传，后端写盘后返回元数据 */
export function uploadRecording(blob: Blob, durationMs: number): Promise<Recording> {
  return request<Recording>(`/api/recordings?durationMs=${durationMs}`, {
    method: 'POST', // 请求体就是音频字节
    headers: { 'Content-Type': 'application/octet-stream' }, // 明确告诉后端这不是 JSON
    body: blob, // Blob 可直接作为 fetch body
  })
}

/** DELETE /api/recordings/:id：删除录音及其全部结果 */
export function deleteRecording(id: string): Promise<void> {
  return request<void>(`/api/recordings/${id}`, { method: 'DELETE' }) // 返回值不用关心
}

/** POST /api/transcribe：让指定 provider 识别指定录音 */
export function transcribe(providerId: string, recordingId: string): Promise<Transcript> {
  return request<Transcript>('/api/transcribe', {
    method: 'POST', // 两个 id 放请求体
    body: JSON.stringify({ providerId, recordingId }), // 后端据此找 provider 与音频文件
  })
}

/** 录音回放地址，直接塞给 <audio src> */
export function audioUrl(id: string): string {
  return `/api/recordings/${id}/audio` // 后端以流的形式返回 webm
}
