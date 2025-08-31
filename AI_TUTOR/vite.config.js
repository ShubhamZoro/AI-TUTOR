
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Optionally relax the warning threshold (still try to split!)
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("three")) return "vendor-three";
            if (id.includes("@react-three/fiber")) return "vendor-r3f";
            if (id.includes("@react-three/drei")) return "vendor-drei";
            if (id.includes("react-markdown") || id.includes("remark") || id.includes("rehype")) {
              return "vendor-markdown";
            }
            if (id.includes("react-dom") || id.includes("react-router")) return "vendor-react";
            return "vendor-misc";
          }
        },
      },
    },
  },
});
