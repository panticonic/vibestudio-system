---
description: Invoke the caller-owned one-time installation capability for the selected ref.
args:
  ref: string
returns: LocalTaskReceipt
---
Call localModelTaskInstall.installOnce(ref) and return its receipt unchanged. Let any effect error reach the caller. Do not choose a different operation or retry.
