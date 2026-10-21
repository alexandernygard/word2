import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // One copy of each: Yjs breaks with two, and @alexandernygard/drive's share dialog must use the app's React.
  resolve: { dedupe: ["yjs", "lib0", "y-protocols", "react", "react-dom", "@alexandernygard/components", "lucide-react"] },
  server: { port: 5273 },
})
