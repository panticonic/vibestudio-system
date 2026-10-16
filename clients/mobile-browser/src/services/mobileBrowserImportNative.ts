import { Platform } from "react-native";
import { base64ToBytes } from "@vibestudio/rpc";
import type { BrowserImportArchiveHandle } from "@vibestudio/rn-client-api";
import { clientApi } from "@workspace/client-kit-native/host";

export type NativeBrowserImportArchive = BrowserImportArchiveHandle;

const READ_CHUNK_BYTES = 256 * 1024;
const MAX_JS_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_JS_ARCHIVE_BYTES = 256 * 1024 * 1024;

// The host holds the staged archives and enforces `browser-import` on each call.
const browserImport = () => clientApi().browserImport;

export async function openSafariBrowserDataExport(): Promise<string> {
  if (Platform.OS !== "ios") {
    throw new Error(
      "Safari browser export is available only on iPhone and iPad.",
    );
  }
  const result = await browserImport().openSafariExport();
  if (!result.opened) {
    throw new Error(
      result.unavailableReason ?? "Safari browser export is unavailable.",
    );
  }
  return "Finish the Safari export, save it to Files, then return and choose the exported ZIP.";
}

export function pickBrowserImportArchive(): Promise<NativeBrowserImportArchive | null> {
  return browserImport().pickArchive();
}

export async function readBrowserImportArchive(
  archive: NativeBrowserImportArchive,
): Promise<Array<{ name: string; bytes: Uint8Array }>> {
  let totalBytes = 0;
  const entries: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const entry of archive.entries) {
    if (entry.size < 0 || entry.size > MAX_JS_ENTRY_BYTES) {
      throw new Error(
        "A browser export entry exceeds the supported mobile import size.",
      );
    }
    totalBytes += entry.size;
    if (totalBytes > MAX_JS_ARCHIVE_BYTES) {
      throw new Error(
        "The browser export is too large to inspect safely on this device.",
      );
    }
    const bytes = new Uint8Array(entry.size);
    let offset = 0;
    while (offset < entry.size) {
      const chunk = await browserImport().readEntry(
        archive.handle,
        entry.name,
        offset,
        Math.min(READ_CHUNK_BYTES, entry.size - offset),
      );
      const decoded = base64ToBytes(chunk.dataBase64);
      if (
        decoded.byteLength === 0 ||
        offset + decoded.byteLength > entry.size
      ) {
        throw new Error(
          "The staged browser export changed while it was being read.",
        );
      }
      bytes.set(decoded, offset);
      offset += decoded.byteLength;
      if (chunk.eof && offset !== entry.size) {
        throw new Error(
          "The staged browser export ended before its declared size.",
        );
      }
    }
    entries.push({ name: entry.name, bytes });
  }
  return entries;
}

export function releaseBrowserImportArchive(handle: string): Promise<void> {
  return browserImport().releaseArchive(handle);
}
