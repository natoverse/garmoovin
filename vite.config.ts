import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: false,
  server: {
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem}',
        '**/.git/**',
        '**/*.[zZ][iI][pP]',
        '**/*.[gG][pP][xX]',
        '**/local-data/**',
      ],
    },
  },
})
