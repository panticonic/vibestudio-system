---
description: Report which local models can run now, which one natlang programs use, and what to do about the ones that cannot.
args: {}
returns: Readiness
budget: { maxTurns: 4, maxTokens: 6144 }
---
Call collect and return its result exactly as collect gave it, from eval. It reads the local model list, names the
cause of each failed model, and assembles the readiness report.
