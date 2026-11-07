import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/log_draw.ts",
      formats: ["es"],
      fileName: "log-draw"
    }
  }
});
