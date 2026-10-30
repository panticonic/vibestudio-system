import type {
  HardwareTier,
  QuantName,
  ServerKind,
} from "@workspace/model-catalog/localModels";
import {
  LOCAL_DEFAULT_MODEL as CATALOG_DEFAULT_MODEL,
  LOCAL_FALLBACK_MODEL as CATALOG_FALLBACK_MODEL,
  LOCAL_PROVIDER_ID,
  canonicalModelRef,
} from "@workspace/model-catalog/catalog";

/** Machine-global storage layout owned by the local-model implementation. */
export const ROOT_LAYOUT = {
  ownerLock: "owner.lock",
  ownerInfo: "owner.json",
  authKey: "auth.key",
  config: "config.json",
  serverLog: (kind: ServerKind) => `${kind}-server.log`,
  enginesDir: "engines",
  modelsDir: "models",
  warmPrefixesDir: "warm-prefixes",
} as const;

export const FALLBACK_MODEL = {
  slug: CATALOG_FALLBACK_MODEL.id,
  ref: CATALOG_FALLBACK_MODEL.ref,
  displayName: CATALOG_FALLBACK_MODEL.name,
  hfRepo: "LiquidAI/LFM2.5-2.6B-GGUF",
  quant: "Q4_K_M" as QuantName,
  file: "LFM2.5-2.6B-Q4_K_M.gguf",
  sha256: "02a8b7e17487d326e46d68ce0ba24211e1b80a14c4cd0597fa73c1cd697f52ed",
  downloadSizeBytes: CATALOG_FALLBACK_MODEL.downloadSizeBytes,
  contextLength: CATALOG_FALLBACK_MODEL.contextWindow,
} as const;

/** Preferred local agent model. It uses the ordinary main-router path; unlike
 * the compact fallback, it is offered only on hardware tiers that can fit it. */
export const DEFAULT_MODEL = {
  slug: CATALOG_DEFAULT_MODEL.id,
  ref: CATALOG_DEFAULT_MODEL.ref,
  displayName: CATALOG_DEFAULT_MODEL.name,
  hfRepo: "unsloth/Qwen3.8-27B-GGUF",
  quant: "UD-Q4_K_M" as QuantName,
  file: "Qwen3.8-27B-UD-Q4_K_M.gguf",
  sha256: "322e194ff79741c7baa497c240f677f54b201b0efab44ca8e50f122b39123482",
  downloadSizeBytes: CATALOG_DEFAULT_MODEL.downloadSizeBytes,
  contextLength: CATALOG_DEFAULT_MODEL.contextWindow,
  supportedTiers: ["gpu-large"] as const,
} as const;

/** A model the extension installs with one call and lists before it is installed. */
export interface OneClickModel {
  slug: string;
  ref: string;
  displayName: string;
  hfRepo: string;
  quant: QuantName;
  file: string;
  sha256: string;
  downloadSizeBytes: number;
  contextLength: number;
}

/** LiquidAI LFM3 1.7B: the small instruction model natlang's executor role runs. Both quants are pinned to the
 * hashes of natlang's stock model list (ts-host/src/model-catalog.ts), so natlang and Vibestudio serve identical
 * bytes. It is a library model on the main server (trained context 262,144 tokens); Q4_K_M is for machines with little
 * RAM. */
export const LFM3_MODEL = {
  slug: "lfm3-1.7b",
  ref: canonicalModelRef(LOCAL_PROVIDER_ID, "lfm3-1.7b"),
  displayName: "LFM3 1.7B",
  hfRepo: "LiquidAI/LFM3-1.7B-GGUF",
  contextLength: 262_144,
  quants: {
    Q8_0: {
      file: "LFM3-1.7B-Q8_0.gguf",
      sha256: "8f6b24182258205e9e01e21f1f24a1f208c1e8115578825d202ce39976af20b6",
      downloadSizeBytes: 1_846_238_496,
    },
    Q4_K_M: {
      file: "LFM3-1.7B-Q4_K_M.gguf",
      sha256: "3793e1e6e2266919d6e015287221b41100175a98eddaba92e111aed3b05c93c4",
      downloadSizeBytes: 1_099_627_808,
    },
  },
} as const;

export function lfm3QuantForTier(tier: HardwareTier | null): keyof typeof LFM3_MODEL.quants {
  return tier === "cpu-min" ? "Q4_K_M" : "Q8_0";
}

export function lfm3ForTier(tier: HardwareTier | null): OneClickModel {
  const quant = lfm3QuantForTier(tier);
  const { slug, ref, displayName, hfRepo, contextLength } = LFM3_MODEL;
  return { slug, ref, displayName, hfRepo, contextLength, quant, ...LFM3_MODEL.quants[quant] };
}
