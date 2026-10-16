import { Share } from "react-native";
import { clientApi } from "@workspace/client-kit-native/host";

/** Copy through the host; fails with the host's refusal when `clipboard` is not granted. */
export function copyToClipboard(value: string): Promise<void> {
  return clientApi().clipboard.setString(value);
}

/** Open through the host; fails with the host's refusal when `open-external` is not granted. */
export function openExternalUrl(url: string): Promise<void> {
  return clientApi().openExternal(url);
}

/** Present the device-native share sheet for text the user explicitly selected. */
export async function shareText(value: string, title?: string): Promise<void> {
  await Share.share(
    { title, message: value },
    { dialogTitle: title ? `Share ${title}` : "Share from Vibestudio", subject: title }
  );
}
