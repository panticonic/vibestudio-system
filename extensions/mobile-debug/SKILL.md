---
name: mobile-debug-extension
description: Build, install, launch, screenshot, verify, and inspect logs for Vibestudio on Android devices or emulators and iOS simulators through the mobile-debug extension.
---

# Mobile Debug Extension

## Platform Backends

- Android uses adb for install, launch, uiautomator taps, screenshots, and
  logcat phase markers.
- iOS simulator support should use `xcrun simctl` for boot/install/launch,
  `simctl io screenshot`, and `simctl spawn <udid> log stream`.
- This extension does not stream logs from physical iOS devices; use
  Console.app, and install with
  `vibestudio mobile install --platform ios --device <udid>`.

## Sandboxed install

From workspace eval, use the extension; don't spawn the CLI or call `adb`
yourself:

```ts
const devices = await extensions.invoke("mobile-debug", "listDevices", []);
const install = await extensions.invoke("mobile-debug", "installAndroid", [
  { device: devices[0]?.serial, resetApp: true, launch: true },
]);
const verification = await extensions.invoke("mobile-debug", "verify", [
  { device: devices[0]?.serial },
]);
return { devices, install, verification };
```

The extension is a thin userland wrapper around the host's typed mobile
service. Android build and install need the complete Vibestudio source checkout
and always target its internal development package. The host runs every
Gradle, Xcode, adb, and `xcrun` process; workspace source paths never select
native code. Calls trigger the scoped `native.mobile.execute` approval.
Automated system tests must satisfy that approval through a host-attested case
authority policy, not by adding an extension flag or a method that skips
approval.

This debug service runs on the workspace server so that headless tests and
userland code can reach raw diagnostics. It uses the same native CLI
primitives as the desktop's phone provisioning service. The normal
install-and-pair UX belongs to that desktop service and is not duplicated here.

`verify` returns a bounded status summary (`installed`, `rendering`,
`screenshotCaptured`, `screenshotBytes`, and `issues`). It does not include the
screenshot bytes; call `screenshot` separately when you need the image.

## Performance receipts

`doctor` reports the selected Android device's ABI and the current internal APK
size in bytes, when available. To profile a source build, pass either a device
(the extension picks its ABI) or an explicit architecture list:

```ts
const devices = await extensions.invoke("mobile-debug", "listDevices", []);
const startedAt = Date.now();
const build = await extensions.invoke("mobile-debug", "buildAndroid", [
  { device: devices[0]?.serial },
]);
const ready = await extensions.invoke("mobile-debug", "verifyWorkspaceReady", [
  { device: devices[0]?.serial, sinceMs: startedAt, timeoutMs: 180_000 },
]);
return { build, ready };
```

The build receipt contains `durationMs`, `architectures`, and `apkBytes`; host
filesystem paths are never passed to workspace code. The build is
intentionally resource-limited (`--no-daemon`, two Gradle workers, in-process
Kotlin compilation), and there is no separate profiling build. A measurement
on a specific device must report the selected ABI. An empty `architectures`
array means the caller measured Gradle's configured default set, not a
device-specific build.

After pairing or provisioning, check that the workspace shell is ready; a
running process is not enough:

```ts
const startedAt = Date.now();
// Run the pairing/provisioning operation here.
const workspace = await extensions.invoke(
  "mobile-debug",
  "verifyWorkspaceReady",
  [{ device: devices[0]?.serial, sinceMs: startedAt, timeoutMs: 180_000 }],
);
```

`verifyWorkspaceReady` waits for the workspace initialization and connection
markers, and fails on panel activation or load errors. The current marker set
is in its returned phase evidence and the extension source; don't copy marker
strings or hard-code cold-start timings in callers.

## Debugging A Bad Mobile Panel

- Android: use logcat, screenshots, and WebView debugging in Debug/Internal
  builds.
- iOS: use simulator screenshots and log stream, and Safari Web Inspector for
  WKWebView in Debug/Internal builds. CDP automation is not available for
  WebViews on mobile.
- If the active bundle is suspect, re-pair or call native reset so the shipped
  bootstrap can recover.

From the source checkout, use the repository mobile smoke entry point for the
target platform. Use the full composition smoke only when the change spans
desktop pairing, transport, mobile activation, and panel loading.
