---
description: Decide whether the profile can continue and needs pairing.
args:
  observed: RemoteProfileRead
returns: "pair" | "route" | "invite-required" | "different-profile" | "recover-profile"
---
Return different-profile for foreign and recover-profile for unusable. For an unpaired profile return pair when an invite is assigned, otherwise invite-required. For account or workspace state return route.
