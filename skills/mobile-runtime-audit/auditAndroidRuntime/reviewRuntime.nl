---
description: Assess the current Android application without changing it.
args:
  operationId: string
returns: AndroidRuntimeReview
---
Call androidRuntimeAudit.observeApplication with operationId. Call assessImage with the full observation. Return app-absent if the package is missing, process-absent if the package is installed without a process, screenshot-unavailable if the process exists without a captured device image, and workspace-unverified if both a process and an image were observed. Return the exact observation, status and image verdict. Workspace readiness requires separate evidence from the workspace shell.
