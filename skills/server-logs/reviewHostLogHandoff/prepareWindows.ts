import type { HostLogHandoffRequest, LogRequest } from "../types.js";

export default function prepareWindows(
  request: HostLogHandoffRequest,
): { earlier: LogRequest; later: LogRequest } {
  if (request.earlier.through > request.later.after) {
    throw new Error("Use non-overlapping host log windows in chronological order.");
  }
  const filter = request.tag === undefined ? {} : { tag: request.tag };
  return {
    earlier: { bounds: request.earlier, ...filter },
    later: { bounds: request.later, ...filter },
  };
}
