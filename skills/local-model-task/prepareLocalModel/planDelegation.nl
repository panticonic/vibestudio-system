---
description: Return a precise local-agent handoff when the observed model can do the requested task.
args:
  request: LocalTaskRequest
  row: LocalTaskInventoryRow | null
returns: '{ disposition: LocalTaskDisposition; handoff: { ref: string; mode: "fresh" | "fork" } | null }'
---
1. Require an actual row for exactly request.modelRef in ready or startable state. Otherwise return installation-unverified with no handoff.
2. When tools are required and absent return unsupported-tools. When the observed context window is smaller than the requested minimum return context-too-small. These outcomes have no handoff.
3. When the task needs the prior conversation return a fork handoff; a self-contained task uses fresh. Return ready-to-delegate and the exact observed local ref. The caller starts its normal agent runtime separately.
