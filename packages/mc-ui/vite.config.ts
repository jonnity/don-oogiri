import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // WSL2からWindowsホスト経由でアクセスする場合など、localhost以外からの接続も受けられるようにする
    host: true,
  },
});
