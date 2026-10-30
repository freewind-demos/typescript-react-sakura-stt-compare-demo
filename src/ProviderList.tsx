// 左栏：provider 列表。选中一个 provider，就会显示它对「当前选中录音」的识别结果
import { useState } from 'react'
import type { FormEvent, MouseEvent } from 'react'
import type { Provider, Results } from '../types'
import { ResultBlock } from './ResultBlock'

type Props = {
  providers: Provider[] // 全部已保存的 provider
  selectedProviderId: string | null // 当前选中的 provider
  selectedRecordingId: string | null // 当前选中的录音，决定卡片下方展示哪条结果
  results: Results // 结果矩阵
  pending: string[] // 正在识别的组合 key
  onSelect: (provider: Provider) => void // 点某个 provider
  onSave: (list: Provider[]) => void // 保存全量列表（新增、编辑、删除都走这里）
  onRetry: (providerId: string) => void // 强制重跑当前组合
}

// 新增表单的初始值，baseURL 给最常见的 OpenAI 兼容根，改成别家只改这一行
const EMPTY_FORM: Provider = {
  id: '',
  name: '',
  baseURL: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'whisper-1',
}

export function ProviderList(props: Props) {
  const [form, setForm] = useState<Provider | null>(null) // null 表示表单收起

  /** 提交表单：有 id 就替换，没 id 就新增 */
  function submit(event: FormEvent) {
    event.preventDefault() // 不走浏览器默认提交
    if (!form) return
    const list = form.id
      ? props.providers.map((p) => (p.id === form.id ? form : p)) // 编辑已有项
      : [...props.providers, { ...form, id: crypto.randomUUID() }] // 新增，id 由前端生成
    props.onSave(list) // 全量交给上层保存
    setForm(null) // 收起表单
  }

  /** 删除一个 provider，点上按钮不要顺带触发卡片选中 */
  function remove(id: string, event: MouseEvent) {
    event.stopPropagation() // 阻止冒泡到 li 的 onClick
    props.onSave(props.providers.filter((p) => p.id !== id)) // 全量里去掉这一项
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Providers</h2>
        <button type="button" className="icon" title="新增 provider" onClick={() => setForm({ ...EMPTY_FORM })}>
          +
        </button>
      </header>

      {form && (
        <form className="provider-form" onSubmit={submit}>
          <input
            placeholder="名称"
            value={form.name}
            required
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <input
            placeholder="Base URL"
            value={form.baseURL}
            required
            onChange={(event) => setForm({ ...form, baseURL: event.target.value })}
          />
          <input
            placeholder="API Key"
            type="password"
            value={form.apiKey}
            onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
          />
          <input
            placeholder="模型"
            value={form.model}
            required
            onChange={(event) => setForm({ ...form, model: event.target.value })}
          />
          <div className="form-actions">
            <button type="submit">保存</button>
            <button type="button" className="secondary" onClick={() => setForm(null)}>
              取消
            </button>
          </div>
        </form>
      )}

      <ul className="cards">
        {props.providers.map((provider) => (
          <li
            key={provider.id}
            className={provider.id === props.selectedProviderId ? 'card selected' : 'card'}
            onClick={() => props.onSelect(provider)}
          >
            <div className="card-head">
              <strong>{provider.name}</strong>
              <span className="muted">{provider.model}</span>
              <button type="button" className="icon" title="编辑" onClick={(event) => { event.stopPropagation(); setForm(provider) }}>
                ✎
              </button>
              <button type="button" className="icon" title="删除" onClick={(event) => remove(provider.id, event)}>
                ×
              </button>
            </div>
            <ResultBlock
              transcript={props.selectedRecordingId ? props.results[provider.id]?.[props.selectedRecordingId] : undefined}
              pending={props.selectedRecordingId ? props.pending.includes(`${provider.id}:${props.selectedRecordingId}`) : false}
              onRetry={() => props.selectedRecordingId && props.onRetry(provider.id)}
            />
          </li>
        ))}
      </ul>
      {props.providers.length === 0 && <p className="empty">还没有 provider</p>}
    </section>
  )
}
