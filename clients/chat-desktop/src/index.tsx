import "@radix-ui/themes/styles.css";
import "@workspace/ui/foundation.css";
import "@workspace/ui/themes/vibestudio.css";
import "@workspace/agentic-chat/styles.css";
import "./chat.css";
import { mountChat } from "./mount";

const container = document.getElementById("app");
if (!container) throw new Error("Renderer root not found");
try {
  mountChat(container);
} catch (error) {
  container.textContent = error instanceof Error ? error.message : String(error);
  throw error;
}
