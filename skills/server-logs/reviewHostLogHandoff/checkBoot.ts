import type { LogBrief } from "../types.js";

export default function checkBoot(serverBootId: string, earlier: LogBrief, later: LogBrief): void {
  if (earlier.serverBootId !== serverBootId || later.serverBootId !== serverBootId) {
    throw new Error("The server boot changed. Read two new windows from the current boot.");
  }
}
