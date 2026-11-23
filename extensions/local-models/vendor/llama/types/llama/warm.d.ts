import type { WarmPrefix } from '../package/warm.js';
import type { LlamaHost } from './host.js';
export type { WarmPrefix } from '../package/warm.js';
export { sharedPrefix } from './warm-opening.js';
export type Opening = {
    system: {
        role: 'system';
        content: string;
    };
    tools: unknown[];
    key: string;
};
/** A request's opening: its system prompt and tools, keyed by their exact content (warm-opening.ts). */
export declare function openingOf(request: {
    messages: readonly unknown[];
    tools?: readonly unknown[];
}): Opening | undefined;
/** The rendered opening up to its last tool line (the shared base of openings that differ only there), if it has two
 * or more tools in a `<tools>` block. */
export declare function baseOf(prefix: string): string | undefined;
/**
 * Make every slot of a llama.cpp server (started with `--slot-save-path directory`, all slots idle) start from this
 * opening: restore its saved state, or prefill it on slot 0 and save it first. `tag` names the model file and build.
 */
export declare function warmOpening(host: LlamaHost, server: {
    endpoint: string;
    headers?: Record<string, string>;
}, directory: string, opening: Opening, tag: string, slots: number): Promise<WarmPrefix | undefined>;
/** Keep the `keep` most recently used warm states of the directory. */
export declare function pruneWarmStates(directory: string, keep?: number): void;
