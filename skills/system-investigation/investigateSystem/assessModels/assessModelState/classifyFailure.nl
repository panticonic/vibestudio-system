---
description: Name the kind of failure a local model's error message describes.
readout: decision
args:
  message: string
returns: "download" | "storage" | "memory" | "engine" | "unknown"
---
Name the kind of failure that message, the error of a local model, describes.

- download: fetching a model or the engine failed: an HTTP error status, a size or checksum mismatch, a body that never
  arrived.
- storage: the disk refused: no space left, permission denied, a file missing or unreadable, a path outside its folder.
- memory: the machine ran out of memory while loading or running the model.
- engine: the llama.cpp server could not start, crashed, exited, or failed its smoke test.
- unknown: none of these.
