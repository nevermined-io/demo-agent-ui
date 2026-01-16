import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

console.log("[demo-agent-ui] main.tsx loaded");

createRoot(document.getElementById("root")!).render(<App />);
