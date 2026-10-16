import { createRoot } from "react-dom/client";
import { ChatApp } from "./ChatApp";
import { readHostBridge } from "./hostBridge";

/**
 * Mount the chat window over the bridges its host gave it. Not under
 * StrictMode: opening a conversation can mint a workspace context, and a
 * development double-mount would mint two.
 */
export function mountChat(container: HTMLElement, scope: object = globalThis): () => void {
  const root = createRoot(container);
  root.render(<ChatApp host={readHostBridge(scope)} />);
  return () => root.unmount();
}
