import { describe, expect, it, vi } from "vitest";
import { createTestDO } from "@workspace/runtime/worker/test-utils";
import { wireCallerFor } from "@vibestudio/rpc/internal";
import { PhoneProvisioningDO } from "./index.js";

class TestPhoneProvisioningDO extends PhoneProvisioningDO {
  wireCallerForTest() {
    return wireCallerFor(this.rpc);
  }
}

describe("PhoneProvisioningDO", () => {
  it("selects the desktop transport and rewrites provider identity", async () => {
    const { instance, callAs } = await createTestDO(TestPhoneProvisioningDO, {
      WORKER_SOURCE: "workers/phone-provisioning",
      WORKER_CLASS_NAME: "PhoneProvisioningDO",
      __objectKey: "workspace-phone-provisioning",
    });
    const rpcCall = vi.fn(
      async (_target: string, method: string): Promise<unknown> => {
        if (method === "phoneNativeEndpoint.desktops") {
          return [
            {
              clientId: "shell:desktop",
              label: "My desktop",
              platform: "desktop",
            },
          ];
        }
        return [
          {
            providerId: "local",
            label: "Native provider",
            hostPlatform: "linux",
            platforms: ["android"],
            sourcePlatforms: ["android"],
            appVersion: "1.0.0",
          },
        ];
      },
    );
    vi.spyOn(instance.wireCallerForTest(), "call").mockImplementation(rpcCall);

    await expect(
      callAs(
        { callerId: "panel:alice", callerKind: "panel", userId: "alice" },
        "providers",
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        providerId: "shell:desktop",
        label: "My desktop",
      }),
    ]);
    expect(rpcCall).toHaveBeenLastCalledWith(
      "main",
      "phoneNativeEndpoint.providers",
      [{ clientId: "shell:desktop" }],
      undefined,
    );
  });
});
