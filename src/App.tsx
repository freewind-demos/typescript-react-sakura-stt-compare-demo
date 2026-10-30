// 页面主体：管住三件事——后端数据、两个选中项、以及由选中项触发的识别请求
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppState, Provider, Recording, Transcript } from '../types'
import * as api from './api'
import { ProviderList } from './ProviderList'
import { RecordingList } from './RecordingList'
import { startRecording } from './recorder'
import type { ActiveRecorder } from './recorder'

/** 一次「provider × 录音」组合的字符串 key，用来标记哪个组合正在请求 */
function pairKey(providerId: string, recordingId: string): string {
  return `${providerId}:${recordingId}`
}

export function App() {
  const [state, setState] = useState<AppState | null>(null) // null 表示首屏还没加载完
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null) // 左栏选中项
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null) // 右栏选中项
  const [pending, setPending] = useState<string[]>([]) // 正在识别的组合，用于显示转圈
  const [error, setError] = useState<string | null>(null) // 最近一次失败的原因
  const [recorder, setRecorder] = useState<ActiveRecorder | null>(null) // 正在录音时的句柄
  const pendingRef = useRef<Set<string>>(new Set()) // 同一组合防重复请求，不依赖渲染

  // 首屏拉一次全量数据，之后所有改动都由接口返回结果就地更新
  useEffect(() => {
    api.fetchState()
      .then(setState)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  /** 让某个 provider 识别某条录音；已有结果且没要求重跑时直接跳过 */
  const runTranscription = useCallback(
    async (providerId: string, recordingId: string, force = false) => {
      const key = pairKey(providerId, recordingId) // 组合唯一标识
      if (pendingRef.current.has(key)) return // 同一组合已经在跑，忽略
      if (!force && state?.results[providerId]?.[recordingId]) return // 已有结果，点一下只是展示
      pendingRef.current.add(key) // 记上，防止连点
      setPending((prev) => [...prev, key]) // 触发转圈
      try {
        const transcript: Transcript = await api.transcribe(providerId, recordingId) // 后端调外部接口并落盘
        setState((prev) =>
          prev
            ? {
                ...prev,
                // 结果按 provider → 录音 两级写回，只动这一格
                results: { ...prev.results, [providerId]: { ...(prev.results[providerId] ?? {}), [recordingId]: transcript } },
              }
            : prev,
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err)) // 失败原因留在顶部展示
      } finally {
        pendingRef.current.delete(key) // 无论成败都解锁
        setPending((prev) => prev.filter((k) => k !== key)) // 收起转圈
      }
    },
    [state],
  )

  /** 点录音：先选中，若已有选中的 provider 就顺手识别这一对 */
  function selectRecording(recording: Recording) {
    setSelectedRecordingId(recording.id)
    if (selectedProviderId) void runTranscription(selectedProviderId, recording.id)
  }

  /** 点 provider：先选中，若已有选中的录音就顺手识别这一对 */
  function selectProvider(provider: Provider) {
    setSelectedProviderId(provider.id)
    if (selectedRecordingId) void runTranscription(provider.id, selectedRecordingId)
  }

  /** 保存 provider 全量列表，后端落盘后回传带 id 的版本 */
  async function saveProviders(list: Provider[]) {
    try {
      const saved = await api.saveProviders(list)
      setState((prev) => (prev ? { ...prev, providers: saved } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** 删除录音：后端连音频和结果一起删，前端同步移除列表项 */
  async function deleteRecording(id: string) {
    try {
      await api.deleteRecording(id)
      setState((prev) => {
        if (!prev) return prev
        // 结果矩阵里这条录音的所有格子一并清掉，避免内存里残留
        const results = Object.fromEntries(
          Object.entries(prev.results).map(([providerId, byRecording]) => {
            const rest = { ...byRecording }
            delete rest[id]
            return [providerId, rest]
          }),
        )
        return { ...prev, recordings: prev.recordings.filter((r) => r.id !== id), results }
      })
      if (selectedRecordingId === id) setSelectedRecordingId(null) // 选中的被删了就清空选中
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** 录音按钮：一次控制开始与停止，停止后立刻上传并选中新录音 */
  async function toggleRecording() {
    if (recorder) {
      setRecorder(null) // 先恢复按钮状态，后面失败也不会卡在录音中
      try {
        const { blob, durationMs } = await recorder.stop() // 结束录音，拿到音频
        const recording = await api.uploadRecording(blob, durationMs) // 音频落到后端磁盘
        setState((prev) => (prev ? { ...prev, recordings: [...prev.recordings, recording] } : prev))
        setSelectedRecordingId(recording.id) // 新录音直接选中，省一次点击
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
      return
    }
    try {
      setRecorder(await startRecording()) // 申请麦克风并开始录
    } catch (err) {
      setError(`无法开始录音：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <main>
      {error && (
        <p className="error" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {state ? (
        <div className="layout">
          <ProviderList
            providers={state.providers}
            selectedProviderId={selectedProviderId}
            selectedRecordingId={selectedRecordingId}
            results={state.results}
            pending={pending}
            onSelect={selectProvider}
            onSave={saveProviders}
            onRetry={(providerId) => selectedRecordingId && void runTranscription(providerId, selectedRecordingId, true)}
          />
          <RecordingList
            recordings={state.recordings}
            selectedRecordingId={selectedRecordingId}
            selectedProviderId={selectedProviderId}
            results={state.results}
            pending={pending}
            isRecording={recorder !== null}
            onSelect={selectRecording}
            onToggleRecording={toggleRecording}
            onDelete={deleteRecording}
            onRetry={(recordingId) => selectedProviderId && void runTranscription(selectedProviderId, recordingId, true)}
          />
        </div>
      ) : null}
    </main>
  )
}
