// 右栏：录音列表。选中一条录音，就会显示「当前选中 provider」对它的识别结果
import type { MouseEvent } from 'react'
import type { Recording, Results } from '../types'
import { audioUrl } from './api'
import { ResultBlock } from './ResultBlock'

type Props = {
  recordings: Recording[] // 全部已保存的录音
  selectedRecordingId: string | null // 当前选中的录音
  selectedProviderId: string | null // 当前选中的 provider，决定卡片下方展示哪条结果
  results: Results // 结果矩阵
  pending: string[] // 正在识别的组合 key
  isRecording: boolean // 是否正在录音，决定按钮文字与样式
  onSelect: (recording: Recording) => void // 点某条录音
  onToggleRecording: () => void // 开始 / 停止录音
  onDelete: (id: string) => void // 删除录音
  onRetry: (recordingId: string) => void // 强制重跑当前组合
}

export function RecordingList(props: Props) {
  /** 删除一条录音，别顺带触发卡片选中 */
  function remove(id: string, event: MouseEvent) {
    event.stopPropagation() // 阻止冒泡到 li 的 onClick
    props.onDelete(id)
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Recordings</h2>
        <button
          type="button"
          className={props.isRecording ? 'record recording' : 'record'}
          onClick={props.onToggleRecording}
        >
          {props.isRecording ? '■' : '●'}
        </button>
      </header>

      <ul className="cards">
        {props.recordings.map((recording) => (
          <li
            key={recording.id}
            className={recording.id === props.selectedRecordingId ? 'card selected' : 'card'}
            onClick={() => props.onSelect(recording)}
          >
            <div className="card-head">
              <strong>{recording.name}</strong>
              <span className="muted">{(recording.durationMs / 1000).toFixed(1)}s</span>
              <button type="button" className="icon" title="删除" onClick={(event) => remove(recording.id, event)}>
                ×
              </button>
            </div>
            <audio controls src={audioUrl(recording.id)} onClick={(event) => event.stopPropagation()} />
            <ResultBlock
              transcript={props.selectedProviderId ? props.results[props.selectedProviderId]?.[recording.id] : undefined}
              pending={props.selectedProviderId ? props.pending.includes(`${props.selectedProviderId}:${recording.id}`) : false}
              onRetry={() => props.selectedProviderId && props.onRetry(recording.id)}
            />
          </li>
        ))}
      </ul>
      {props.recordings.length === 0 && <p className="empty">还没有录音</p>}
    </section>
  )
}
