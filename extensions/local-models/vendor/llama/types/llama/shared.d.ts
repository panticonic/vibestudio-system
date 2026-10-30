import type { LlamaHost } from './host.js';
export type SharedServer = {
    schema: 'natlang.shared-model-server/1';
    pid: number;
    endpoint: string;
    modelSha256: string;
    runtimeBuild: number | null;
    /** The binary's `b<build>g<commit>` label (llama/models.ts runtimeLabel); sessions match on it. */
    runtime: string | null;
    slots: number;
    contextPerSlot: number;
    model: string;
    profile: string;
    startedAt: string;
    /** The server saves and restores warm prompt openings (it was started with their --slot-save-path). */
    warm: boolean;
};
export declare const sharedServerPath: (host: LlamaHost) => string;
export declare function publishSharedServer(host: LlamaHost, server: Omit<SharedServer, 'schema'>): void;
/** Remove the published server, if it is still the one `pid` published. */
export declare function withdrawSharedServer(host: LlamaHost, pid: number): void;
export declare function readSharedServer(host: LlamaHost): SharedServer | undefined;
/** The published server, when it serves exactly this model file on this llama.cpp binary and answers its health check. */
export declare function findSharedServer(host: LlamaHost, modelSha256: string, runtime: string): Promise<SharedServer | undefined>;
