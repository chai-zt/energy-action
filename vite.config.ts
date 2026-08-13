import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const apiPort = loadEnv(mode, '.', 'PERSONAL_AI_OS_').PERSONAL_AI_OS_API_PORT || '4001'

  return {
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // 服务端回归使用 Node 原生运行器；单元测试只收集项目自身的 Vitest 测试。
    include: ['src/test/**/*.{test,spec}.{ts,tsx}'],
  },
  }
})
