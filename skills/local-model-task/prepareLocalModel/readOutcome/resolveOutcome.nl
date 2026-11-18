---
description: Decide how far an installation receipt and fresh readback establish readiness.
args:
  observed: LocalTaskDisposition
  receipt: LocalTaskReceipt
returns: LocalTaskDisposition
---
1. Keep usable, wait-for-progress, catalog-error, and too-big when the current inventory establishes them.
2. A receipt with unavailable or needs-install still has no verified ready model. Return installation-unverified, including when the install returned state-changed.
