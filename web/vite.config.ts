import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/**
 * The UI lives in `web/` and is built to `web/dist`, which the Express server
 * serves in production. In dev, Vite proxies `/api` to the API so the browser
 * sees a single origin and no CORS setup is needed.
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
})
