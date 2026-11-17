import { PanelDevicePowers, type DevicePowersHost } from "./panelDevicePowers";

function host(granted = true) {
  const calls: unknown[][] = [];
  const h: DevicePowersHost = {
    granted: () => granted,
    setKeepAwake: async (on) => void calls.push(["keepAwake", on]),
    haptic: async (kind) => void calls.push(["haptic", kind]),
    speak: async (request) => void calls.push(["speak", request.text]),
    stopSpeaking: async () => void calls.push(["stop"]),
  };
  return { h, calls };
}

it("keeps the screen on only while a panel that asked is shown", async () => {
  const { h, calls } = host();
  const powers = new PanelDevicePowers(h);
  await powers.setVisiblePanel("trip");
  await powers.keepAwake("trip", true);
  await powers.setVisiblePanel("chat");
  await powers.setVisiblePanel("trip");
  await powers.releasePanel("trip");
  expect(calls).toEqual([
    ["keepAwake", true],
    ["keepAwake", false],
    ["keepAwake", true],
    ["keepAwake", false],
  ]);
});

it("stops a hidden panel's speech", async () => {
  const { h, calls } = host();
  const powers = new PanelDevicePowers(h);
  await powers.setVisiblePanel("trip");
  let finish!: () => void;
  h.speak = () => new Promise<void>((resolve) => (finish = resolve));
  const speaking = powers.speak("trip", { text: "Turn left" });
  await powers.setVisiblePanel("chat");
  expect(calls).toContainEqual(["stop"]);
  finish();
  await speaking;
});

it("says plainly when the host does not grant device powers", async () => {
  const { h } = host(false);
  const powers = new PanelDevicePowers(h);
  expect(powers.capabilities()).toEqual([]);
  await expect(powers.keepAwake("trip", true)).rejects.toThrow("does not offer device powers");
  await expect(powers.setVisiblePanel("trip")).resolves.toBeUndefined();
});

it("forgets requests of panels whose page is gone", async () => {
  const { h, calls } = host();
  const powers = new PanelDevicePowers(h);
  await powers.setVisiblePanel("trip");
  await powers.keepAwake("trip", true);
  await powers.retainOnly(new Set(["chat"]));
  expect(calls).toEqual([
    ["keepAwake", true],
    ["keepAwake", false],
  ]);
});
