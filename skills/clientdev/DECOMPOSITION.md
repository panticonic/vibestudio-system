# Client admission review

This workflow reviews a System client against a selected host contract.
It reads the working and published client manifest, published System trust,
and the actual workspace build catalog. The host profile comes from the
current contract catalog for the selected platform. It is not a claim about
a connected device or a launch receipt.

- Source inspection distinguishes a working client contract from the published
  contract and retains exact semantic revisions.
- Host review branches into runtime and ABI compatibility, then delegates the
  capability check to separate required and optional functions. Required
  capability checks report host support and System trust independently.
  Optional denials stay in their own list for the final admission decision.
- The final decision combines those reviews with the published build entry.
  A compatible contract and a ready catalog row still do not authorize launch.
- TypeScript handles exact VCS and build reads, configuration parsing and
  projection of the canonical host profile. No client or device effect is bound.
