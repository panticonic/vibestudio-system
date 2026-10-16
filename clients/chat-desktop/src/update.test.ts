import { describe, expect, it, vi } from "vitest";
import { createChatUpdateModel } from "./update";
import { fakeHost } from "./testing";

const offer = {
  clientId: "chat",
  source: "clients/chat-desktop",
  buildKey: "build-2",
  effectiveVersion: "0.2.0",
  previousEffectiveVersion: "0.1.0",
};

describe("chat update model", () => {
  it("shows the update the host already holds, and follows later offers and their retirement", async () => {
    const fake = fakeHost();
    fake.setPendingOffer(offer);
    const { model, dispose } = createChatUpdateModel(fake.host);
    await vi.waitFor(() => expect(model.getSnapshot().pending).toHaveLength(1));
    expect(model.getSnapshot().pending[0]).toMatchObject({
      clientId: "chat",
      runtime: "web",
      toVersion: "0.2.0",
      fromVersion: "0.1.0",
      canRollback: false,
    });
    fake.offerUpdate(null);
    expect(model.getSnapshot().pending).toEqual([]);
    fake.offerUpdate({ ...offer, buildKey: "build-3" });
    expect(model.getSnapshot().pending[0]?.buildKey).toBe("build-3");
    dispose();
    expect(fake.updateSubscribers()).toBe(0);
  });

  it("applies through the host's restart and reports a refusal", async () => {
    const fake = fakeHost();
    const { model } = createChatUpdateModel(fake.host);
    fake.offerUpdate(offer);
    await model.apply("chat");
    expect(fake.update.restartAtSafePoint).toHaveBeenCalledTimes(1);
    expect(model.getSnapshot().pending).toEqual([]);

    fake.offerUpdate(offer);
    fake.update.restartAtSafePoint.mockRejectedValueOnce(new Error("chat has no pending update"));
    await expect(model.apply("chat")).rejects.toThrow("no pending update");
    expect(model.getSnapshot().notices[0]?.tone).toBe("danger");
  });
});
