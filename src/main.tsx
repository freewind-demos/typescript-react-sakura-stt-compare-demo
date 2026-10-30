// 前端入口：先载入 sakura.css 主题，再载入少量自定义布局，最后挂载根组件
import { createRoot } from 'react-dom/client'
import 'sakura.css/css/sakura.css' // classless 主题，所有原生元素自动获得样式
import './styles.css' // 只放布局与本 demo 需要的少量覆盖
import { App } from './App'

const container = document.getElementById('root') // index.html 里的挂载点
if (!container) throw new Error('缺少 #root 挂载点') // 早点炸掉，别静默白屏

createRoot(container).render(<App />) // React 19 的 createRoot 即可
