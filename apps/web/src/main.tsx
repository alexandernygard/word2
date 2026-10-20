import { Toaster, TooltipProvider } from "@alexandernygard/components"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./index.css"

if (window.matchMedia("(prefers-color-scheme: dark)").matches && localStorage.getItem("word2.theme") !== "light") document.documentElement.classList.add("dark")
if (localStorage.getItem("word2.theme") === "dark") document.documentElement.classList.add("dark")

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delayDuration={400}>
      <App />
      <Toaster />
    </TooltipProvider>
  </StrictMode>,
)
