---
description: Audit an assigned Android device and, when requested, its current internal Vibestudio application.
args:
  request: AndroidAuditRequest
returns: AndroidAuditReport
---
Call androidRuntimeAudit.observeTarget with request.operationId. Call reviewTarget with that observation. If the target is ready and intent is application, call reviewRuntime with the assignment's operation ID. Otherwise return null runtime. Return the original target observation, target review and runtime review. Keep the runtime state tied to this target.
