var _a, _b;
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    base: (_a = process.env.OTA_WEB_BASE_PATH) !== null && _a !== void 0 ? _a : '/',
    server: {
        port: 5180,
        proxy: {
            '/api': (_b = process.env.OTA_API_PROXY_TARGET) !== null && _b !== void 0 ? _b : 'http://localhost:8091',
        },
    },
});
