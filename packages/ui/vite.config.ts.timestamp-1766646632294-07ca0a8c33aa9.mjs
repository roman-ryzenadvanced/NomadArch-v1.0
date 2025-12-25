// vite.config.ts
import { defineConfig } from "file:///E:/TRAE%20Playground/NeuralNomadsAi/NomadArch/node_modules/vite/dist/node/index.js";
import solid from "file:///E:/TRAE%20Playground/NeuralNomadsAi/NomadArch/node_modules/vite-plugin-solid/dist/esm/index.mjs";
import { resolve } from "path";
var __vite_injected_original_dirname = "E:\\TRAE Playground\\NeuralNomadsAi\\NomadArch\\packages\\ui";
var vite_config_default = defineConfig({
  root: "./src/renderer",
  publicDir: resolve(__vite_injected_original_dirname, "./public"),
  plugins: [solid()],
  css: {
    postcss: "./postcss.config.js"
  },
  resolve: {
    alias: {
      "@": resolve(__vite_injected_original_dirname, "./src")
    }
  },
  optimizeDeps: {
    exclude: ["lucide-solid"]
  },
  ssr: {
    noExternal: ["lucide-solid"]
  },
  server: {
    port: Number(process.env.VITE_PORT ?? 3e3),
    hmr: false
    // DISABLED - HMR WebSocket was causing issues
  },
  build: {
    outDir: resolve(__vite_injected_original_dirname, "dist"),
    chunkSizeWarningLimit: 1e3,
    rollupOptions: {
      input: {
        main: resolve(__vite_injected_original_dirname, "./src/renderer/index.html"),
        loading: resolve(__vite_injected_original_dirname, "./src/renderer/loading.html")
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJFOlxcXFxUUkFFIFBsYXlncm91bmRcXFxcTmV1cmFsTm9tYWRzQWlcXFxcTm9tYWRBcmNoXFxcXHBhY2thZ2VzXFxcXHVpXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJFOlxcXFxUUkFFIFBsYXlncm91bmRcXFxcTmV1cmFsTm9tYWRzQWlcXFxcTm9tYWRBcmNoXFxcXHBhY2thZ2VzXFxcXHVpXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9FOi9UUkFFJTIwUGxheWdyb3VuZC9OZXVyYWxOb21hZHNBaS9Ob21hZEFyY2gvcGFja2FnZXMvdWkvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiXHJcbmltcG9ydCBzb2xpZCBmcm9tIFwidml0ZS1wbHVnaW4tc29saWRcIlxyXG5pbXBvcnQgeyByZXNvbHZlIH0gZnJvbSBcInBhdGhcIlxyXG5cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcclxuICByb290OiBcIi4vc3JjL3JlbmRlcmVyXCIsXHJcbiAgcHVibGljRGlyOiByZXNvbHZlKF9fZGlybmFtZSwgXCIuL3B1YmxpY1wiKSxcclxuICBwbHVnaW5zOiBbc29saWQoKV0sXHJcbiAgY3NzOiB7XHJcbiAgICBwb3N0Y3NzOiBcIi4vcG9zdGNzcy5jb25maWcuanNcIixcclxuICB9LFxyXG4gIHJlc29sdmU6IHtcclxuICAgIGFsaWFzOiB7XHJcbiAgICAgIFwiQFwiOiByZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyY1wiKSxcclxuICAgIH0sXHJcbiAgfSxcclxuICBvcHRpbWl6ZURlcHM6IHtcclxuICAgIGV4Y2x1ZGU6IFtcImx1Y2lkZS1zb2xpZFwiXSxcclxuICB9LFxyXG4gIHNzcjoge1xyXG4gICAgbm9FeHRlcm5hbDogW1wibHVjaWRlLXNvbGlkXCJdLFxyXG4gIH0sXHJcbiAgc2VydmVyOiB7XHJcbiAgICBwb3J0OiBOdW1iZXIocHJvY2Vzcy5lbnYuVklURV9QT1JUID8/IDMwMDApLFxyXG4gICAgaG1yOiBmYWxzZSwgLy8gRElTQUJMRUQgLSBITVIgV2ViU29ja2V0IHdhcyBjYXVzaW5nIGlzc3Vlc1xyXG4gIH0sXHJcbiAgYnVpbGQ6IHtcclxuICAgIG91dERpcjogcmVzb2x2ZShfX2Rpcm5hbWUsIFwiZGlzdFwiKSxcclxuICAgIGNodW5rU2l6ZVdhcm5pbmdMaW1pdDogMTAwMCxcclxuICAgIHJvbGx1cE9wdGlvbnM6IHtcclxuICAgICAgaW5wdXQ6IHtcclxuICAgICAgICBtYWluOiByZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyYy9yZW5kZXJlci9pbmRleC5odG1sXCIpLFxyXG4gICAgICAgIGxvYWRpbmc6IHJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjL3JlbmRlcmVyL2xvYWRpbmcuaHRtbFwiKSxcclxuICAgICAgfSxcclxuICAgIH0sXHJcbiAgfSxcclxufSlcclxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFxVyxTQUFTLG9CQUFvQjtBQUNsWSxPQUFPLFdBQVc7QUFDbEIsU0FBUyxlQUFlO0FBRnhCLElBQU0sbUNBQW1DO0FBSXpDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLE1BQU07QUFBQSxFQUNOLFdBQVcsUUFBUSxrQ0FBVyxVQUFVO0FBQUEsRUFDeEMsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLEtBQUs7QUFBQSxJQUNILFNBQVM7QUFBQSxFQUNYO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLFFBQVEsa0NBQVcsT0FBTztBQUFBLElBQ2pDO0FBQUEsRUFDRjtBQUFBLEVBQ0EsY0FBYztBQUFBLElBQ1osU0FBUyxDQUFDLGNBQWM7QUFBQSxFQUMxQjtBQUFBLEVBQ0EsS0FBSztBQUFBLElBQ0gsWUFBWSxDQUFDLGNBQWM7QUFBQSxFQUM3QjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTSxPQUFPLFFBQVEsSUFBSSxhQUFhLEdBQUk7QUFBQSxJQUMxQyxLQUFLO0FBQUE7QUFBQSxFQUNQO0FBQUEsRUFDQSxPQUFPO0FBQUEsSUFDTCxRQUFRLFFBQVEsa0NBQVcsTUFBTTtBQUFBLElBQ2pDLHVCQUF1QjtBQUFBLElBQ3ZCLGVBQWU7QUFBQSxNQUNiLE9BQU87QUFBQSxRQUNMLE1BQU0sUUFBUSxrQ0FBVywyQkFBMkI7QUFBQSxRQUNwRCxTQUFTLFFBQVEsa0NBQVcsNkJBQTZCO0FBQUEsTUFDM0Q7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
