import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig({
  base: "./",
  plugins: [react()],
  optimizeDeps: { include: ["scheduler"] },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("three")) return "vendor-three";
            if (id.includes("@react-three/fiber")) return "vendor-r3f";
            if (id.includes("@react-three/drei")) return "vendor-drei";
            if (id.includes("react-markdown") || id.includes("remark") || id.includes("rehype")) return "vendor-markdown";
            if (id.includes("react-dom") || id.includes("react-router")) return "vendor-react";
            // keep scheduler with react to avoid odd interop splits:
            if (id.includes("/scheduler/")) return "vendor-react";
            return "vendor-misc";
          }
        },
      },
    },
  },
});
