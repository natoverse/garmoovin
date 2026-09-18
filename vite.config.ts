import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/garmoovin/',
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
        '**/garmin-title-mappings*.json',
        '**/local-data/**',
        '**/.venv/**',
        '**/garmin_writer/**',
        '**/garmin_tokens.json',
        '**/oauth1_token.json',
        '**/oauth2_token.json',
      ],
    },
  },
})
