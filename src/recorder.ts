// 录音封装：用浏览器原生 MediaRecorder 录成 webm/opus，停止时一次性给出音频与时长

/** 一段正在进行的录音，调用 stop 结束并拿到结果 */
export type ActiveRecorder = {
  stop: () => Promise<{ blob: Blob; durationMs: number }>
}

/** 申请麦克风并开始录音；申请被拒会直接抛错，由调用方展示 */
export async function startRecording(): Promise<ActiveRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }) // 浏览器会弹权限框
  // 优先用 opus 编码，体积小且各家 STT 都认；不支持就交给浏览器自选
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined) // 不指定类型时用默认
  const chunks: Blob[] = [] // 录音数据分片到达，攒起来再拼
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data) // 空分片丢掉
  }
  const startedAt = Date.now() // 用墙钟计时长，够展示用
  recorder.start() // 开始录音

  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop()) // 释放麦克风，否则浏览器标签页一直亮红点
          resolve({ blob: new Blob(chunks, { type: 'audio/webm' }), durationMs: Date.now() - startedAt })
        }
        recorder.stop() // 触发最后一轮 ondataavailable 后再进入 onstop
      }),
  }
}
