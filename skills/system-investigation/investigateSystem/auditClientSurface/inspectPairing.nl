---
description: Interpret an observed pairing invitation and settlement without creating or redeeming invitations.
args:
  evidence: SystemPairingAudit
returns: SystemInvestigationReport
---
Return one finding. If the invite lacks a deep link or room, return blocked with code incomplete-pairing-invite and cite the invite. Otherwise use only lifecycle events for that exact invite ID. A paired event means ready with code pairing-settled. An expired or cancelled event means blocked with code pairing-expired or pairing-cancelled. Cite that actual event. If no matching event exists but an inventory poll was used, return inconclusive with code unproven-by-device-inventory and cite the poll. Otherwise return inconclusive with code pairing-pending and cite the invite. Never report receipt from another invite as success.
