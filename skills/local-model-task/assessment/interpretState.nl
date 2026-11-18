---
description: Distinguish usable, absent, pending, missing, and failed inventory states.
args:
  row: LocalTaskInventoryRow | null
returns: LocalTaskDisposition
---
1. Return unavailable if the selected model is absent.
2. A ready or startable row means usable. Downloading or starting means wait-for-progress. Error means catalog-error.
3. A not-installed row with a too-big fit means too-big. Otherwise a not-installed row means needs-install.
