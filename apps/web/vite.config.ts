import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const apiPort = env.PORT || '3001';
  return {
    plugins: [react(), tailwindcss()],
    envDir: repoRoot,
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
    },
  };
});
