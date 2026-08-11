import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // スマホや別ホスト(WSL2のWindows転送など)からのアクセスも受け付ける
    host: true,
  },
});
