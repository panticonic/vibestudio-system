import { Share } from "react-native";
import { installClientApi } from "@workspace/client-kit-native/host";
import { createFakeClientHost } from "@workspace/client-kit-native/testing";
import { copyToClipboard, openExternalUrl, shareText } from "./nativeCapabilities";

describe("nativeCapabilities", () => {
  it("hands panel addresses to the operating system share sheet", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({
      action: Share.sharedAction,
    });

    await shareText("panels/chat", "Agentic Chat");

    expect(share).toHaveBeenCalledWith(
      { title: "Agentic Chat", message: "panels/chat" },
      { dialogTitle: "Share Agentic Chat", subject: "Agentic Chat" }
    );
  });

  it("copies and opens through the host, which enforces the grants", async () => {
    const fake = await createFakeClientHost({
      handlers: {
        "openExternal.open": () => {
          throw Object.assign(new Error("open-external is not granted"), {
            code: "CAPABILITY_NOT_GRANTED",
          });
        },
      },
    });
    installClientApi(fake.api);

    await copyToClipboard("panels/chat");
    expect(fake.callsOf("clipboard.setString")).toEqual([["panels/chat"]]);
    await expect(openExternalUrl("https://example.test/")).rejects.toMatchObject({
      code: "CAPABILITY_NOT_GRANTED",
    });
  });
});
