import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split React + Router into a stable vendor chunk
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // Animation library — used everywhere but heavy
          'framer': ['framer-motion'],
          // Supabase client
          'supabase': ['@supabase/supabase-js'],
          // Charts (heavy, only used on a few pages)
          'charts': ['recharts'],
          // Markdown rendering (used in chat + lessons)
          'markdown': ['react-markdown'],
          // Calendar utilities
          'date': ['date-fns'],
          // Drag-and-drop (only used on Courses page)
          'dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          // Form validation
          'forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          // WebGL aurora (login page only)
          'webgl': ['ogl'],
          // Confetti (achievements)
          'confetti': ['canvas-confetti'],
        },
      },
    },
  },
}));
