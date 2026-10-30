# STT Provider 对比 Demo

## 简介

在一个页面里录几段语音，同时配置多个 OpenAI 兼容的语音识别（STT）服务，交叉对比它们对同一段音频的识别结果。

左栏是 provider，右栏是录音。选中一个 provider 再点录音，识别结果出现在那条录音下面；反过来先选录音再点 provider，结果出现在那个 provider 下面。每次「provider × 录音」的组合只请求一次，结果落盘，刷新或重启都还在。

## 快速开始

### 环境要求

Node.js 18 以上（后端用到全局 `fetch`、`FormData`、`Blob`）与 pnpm。

### 运行

```bash
pnpm install
pnpm dev
```

浏览器自动打开 `http://localhost:5173`，前后端同一个端口。

## 注意事项

页面用麦克风录音，浏览器只在 `localhost` 或 https 页面下允许录音，用局域网 IP 访问时录不了。

必须在项目根目录执行 `pnpm dev`，后端把数据写到「运行目录/data」，换目录启动会读到空数据。

`data/db.json` 里存着 provider 的 API Key 明文，`data/` 已加入 `.gitignore`，只留在本机。

后端是 Vite 的 middleware，只在 `pnpm dev` 时存在。`pnpm build` 只打包前端，产物里没有 `/api`。

换个服务商只需要在左栏加一条 provider：

- OpenAI：Base URL `https://api.openai.com/v1`，模型 `whisper-1` 或 `gpt-4o-transcribe`
- Groq：Base URL `https://api.groq.com/openai/v1`，模型 `whisper-large-v3`
- 硅基流动：Base URL `https://api.siliconflow.cn/v1`，模型 `FunAudioLLM/SenseVoiceSmall`

## 教程

### 1. 关键概念

各家语音识别服务的 HTTP 接口几乎都是 OpenAI 那一套：向 `{baseURL}/audio/transcriptions` 发一个 multipart 表单，带 `file`（音频文件）和 `model`（模型名），用 `Authorization: Bearer {apiKey}` 鉴权，返回 JSON 里的 `text` 字段就是识别结果。

所以一个 provider 只需要四个参数就能描述清楚：Base URL、API Key、模型名，再加一个给自己看的名字。换服务商不用改代码，加一条配置就行。

本 demo 想把「同一段音频被不同模型识别」的结果并排看，所以数据模型是一个二维矩阵：`results[providerId][recordingId]`。这个矩阵的两个维度正好对应页面的两个方向，左栏按 provider 取一行，右栏按录音取一列。

### 2. demo 原理

前后端跑在同一个 Vite dev server 上。前端是普通的 React 单页，后端没有任何框架，就是一个 Vite 插件，在 `configureServer` 里往 connect 中间件栈上挂一个处理函数，把所有 `/api/*` 的请求接过来。

这样做的好处是省掉端口、跨域和代理配置，音频上传和 API Key 也不必经过浏览器直连外部服务。

磁盘上只有两样东西：

```
data/db.json                     全部结构化数据
data/recordings/<id>.webm        音频二进制，一条录音一个文件
```

`db.json` 里同时存 provider 配置、录音元数据（名字、时长、创建时间）和识别结果矩阵。录音文件单独存，不塞进 JSON，避免 base64 膨胀。

页面上两个选中项（选中的 provider、选中的录音）决定了当前展示哪一格结果。点任一侧都会先把那一侧选中，再看另一侧有没有选中项：有就说明凑齐了一对，于是发起识别；没有就只是改变选中态，等着用户去点另一侧。

### 3. 关键代码解读

`server/api-plugin.ts` 是接口层的全部。`handle()` 里按「路径 + 方法」逐个匹配，接口只有六个：

```
GET    /api/state                    一次拉全量数据
PUT    /api/providers                全量覆盖 provider 列表
POST   /api/recordings?durationMs=   请求体是音频原始字节
GET    /api/recordings/:id/audio     回放，返回 audio/webm
DELETE /api/recordings/:id           连音频和结果一起删
POST   /api/transcribe               请求体 { providerId, recordingId }
```

注意音频上传没有用 multipart，而是把 `Blob` 直接当请求体发，时长走查询参数。后端拿到的就是一个 Buffer，直接 `writeFile` 落盘，省掉解析 multipart 的代码。

`server/store.ts` 里有一个小细节：

```ts
let writeChain: Promise<void> = Promise.resolve()

export function saveDb(): Promise<void> {
  const snapshot = JSON.stringify(db, null, 2)
  writeChain = writeChain.then(() => writeFile(DB_FILE, snapshot))
  return writeChain
}
```

每次写盘都先把内存数据序列化成快照，再串到一条 Promise 链上。这样多个请求同时触发保存时，写入是排队执行的，不会两个 `writeFile` 交错把 `db.json` 写坏。快照在入队时就固定了，后入队的不会覆盖先入队的内容。

`src/App.tsx` 里的识别逻辑只有一个入口：

```ts
const runTranscription = useCallback(async (providerId, recordingId, force = false) => {
  const key = `${providerId}:${recordingId}`
  if (pendingRef.current.has(key)) return      // 同一组合已经在跑
  if (!force && state?.results[providerId]?.[recordingId]) return  // 已有结果
  ...
})
```

`force` 就是卡片右下角那个 ↻ 按钮，跳过缓存重新识别。默认路径下这一对已识别过就直接显示旧结果，来回点不会反复烧钱。

`src/recorder.ts` 用原生 `MediaRecorder` 录成 `audio/webm;codecs=opus`。停止录音时同时做两件事：停掉所有音轨（否则浏览器标签页一直显示正在录音）并拼出 Blob。时长用 `Date.now()` 差值算，只用于展示，不追求精确。
