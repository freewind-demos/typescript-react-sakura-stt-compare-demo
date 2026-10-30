// 一次识别结果的展示块：识别中显示转圈，有结果就显示文本、耗时和重试按钮
import type { Transcript } from '../types'

type Props = {
  transcript: Transcript | undefined // 当前这一对（provider × 录音）已有的结果
  pending: boolean // 这次组合是否正在请求中
  onRetry: () => void // 强制重新识别
}

export function ResultBlock({ transcript, pending, onRetry }: Props) {
  if (pending) return <div className="result result-pending"><span className="spinner" /></div> // 只有动画，不写文字
  if (!transcript) return null // 还没有结果就留白，等用户去触发

  return (
    <div className="result" onClick={(event) => event.stopPropagation()}>
      <p className="result-text">{transcript.text || '（空）'}</p>
      <div className="result-meta">
        <span>{(transcript.durationMs / 1000).toFixed(1)}s</span>
        <button type="button" className="icon" title="重新识别" onClick={onRetry}>
          ↻
        </button>
      </div>
    </div>
  )
}
