// Vite 配置：注册 React 插件和后端 /api 插件，前后端共用一个端口
import { defineConfig } from 'vite' // Vite 的类型化配置函数
import react from '@vitejs/plugin-react' // 支持 JSX 与 React Fast Refresh
import { apiPlugin } from './server/api-plugin.ts' // 本地后端，挂在 dev server 的 middleware 上

export default defineConfig({
  plugins: [react(), apiPlugin()], // 插件顺序无关，vite 会各管各的中间件
})
