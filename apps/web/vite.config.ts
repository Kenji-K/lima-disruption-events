import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        // '@/' alias per shadcn/ui convention (adopted 2026-06-11 for new components).
        alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
});
