---
description: Reconcile inspected windows and determine the supported incident disposition and handoff authority.
args:
  goal: string
  inspections: Inspection[]
  mayStage: boolean
returns: DiagnosticDecision
---
Return a DiagnosticDecision from these inspections. The caller binds its evidence to native citations and stages an artifact when the returned stage flag authorizes it.

1. Establish the named operation and compare only matching owned checkpoints. Failure followed by an explicit successful completion of that same operation can support recovered on the same boot. If evidence stops at progress, an unrelated success, silence or a restart, explain the limitation. Do not infer completion from fewer warnings.
2. Use ongoing for a matching unresolved failure. Use attention if an observed delay or queued retry is itself the finding, even if the task eventually settled. Use clear for a bounded check with no relevant issue or an explicit completed result without a matching earlier failure. Use unconfirmed when the missing evidence itself prevents the conclusion the user needs, such as whether the old incident recovered. A clipped or foreign cursor cannot support a claim across the missing interval. An isolated observation cannot establish a resource leak or its cause.
3. Put a precise answer to the goal in reason. Identify explicit observations by sourceId and sequence in evidence. Include both sides when the user asks to compare them. Cite no record for a missing window. State whether the current checkpoint can support continued investigation when the user needs that distinction.
4. Set stage true only when the goal asks for a scratch handoff, mayStage is true, and the user's requested evidence condition is met. Otherwise set stage false, including for a read-only report.
