import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { strictPort: true, proxy: { "/api": "http://127.0.0.1:8080" } },
  build: {
    rolldownOptions: {
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          groups: [
            {
              name: "vendor",
              test: /node_modules/,
              maxSize: 250000,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
