import { PresentationRequestInbox, type MobilePresentationRequest } from "./presentationRequests";

const request = (slotId: string, deviceId = "phone-1", focus = true): MobilePresentationRequest => ({
  slotId,
  deviceId,
  focus,
  alert: "none",
});

it("delivers only requests addressed to this device", () => {
  const inbox = new PresentationRequestInbox(() => "phone-1");
  const seen: string[] = [];
  inbox.subscribe((r) => seen.push(r.slotId));
  inbox.receive(request("trip"));
  inbox.receive(request("desk-only", "desk-1"));
  expect(seen).toEqual(["trip"]);
});

it("holds requests until the screen subscribes, newest per slot", () => {
  const inbox = new PresentationRequestInbox(() => "phone-1");
  inbox.receive(request("trip", "phone-1", false));
  inbox.receive(request("timer"));
  inbox.receive(request("trip", "phone-1", true));
  const seen: MobilePresentationRequest[] = [];
  inbox.subscribe((r) => seen.push(r));
  expect(seen.map((r) => [r.slotId, r.focus])).toEqual([
    ["timer", true],
    ["trip", true],
  ]);
  inbox.receive(request("later"));
  expect(seen.at(-1)?.slotId).toBe("later");
});

it("drops everything when the workspace closes", () => {
  const inbox = new PresentationRequestInbox(() => "phone-1");
  inbox.receive(request("trip"));
  inbox.clear();
  const seen: string[] = [];
  inbox.subscribe((r) => seen.push(r.slotId));
  expect(seen).toEqual([]);
});
