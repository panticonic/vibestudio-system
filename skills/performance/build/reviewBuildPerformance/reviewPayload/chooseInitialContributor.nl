---
description: Select the largest observed input of the initial panel payload.
args:
  contributors: '{ source: string; bytes: number }[]'
returns: '{ source: string; bytes: number }'
---
Return the contributor with the greatest byte count. Take the first listed contributor among ties. Copy both fields exactly.
