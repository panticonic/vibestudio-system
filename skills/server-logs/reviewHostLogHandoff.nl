---
description: Compare two bounded host-log windows and decide which evidence to hand off for follow-up.
args:
  request: HostLogHandoffRequest
returns: HostLogHandoffReport
uses: [briefServerLog]
---
1. Call prepareWindows with request. Call briefServerLog once per assigned window with the returned earlier and later inputs. Keep the two exact results.
2. Call checkBoot using request.serverBootId and the two briefs before making a comparison.
3. Call interpretLogProgress with the user's goal and the two briefs. Return the status it chose and both exact briefs from eval.
