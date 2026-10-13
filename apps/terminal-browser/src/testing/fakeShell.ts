/**
 * Test doubles for the browser's server side: a shell extension whose PTY
 * sessions speak the real framed attach stream (`@workspace/pty-stream`), and
 * a terminal launch service that registers sessions in it.
 */
import { encodePtyStreamEvent, type PtyAttachOptions } from "@workspace/pty-stream";
import type { ShellClient } from "../sessions/shellSession.js";
import type {
  LaunchRequest,
  TerminalSessionEntry,
  TerminalSessions,
  TerminalSettingsStore,
} from "../sessions/launcher.js";

const encoder = new TextEncoder();

interface FakePty {
  output: Uint8Array;
  alive: boolean;
  exit?: { code: number | null; signal?: string };
  cols: number;
  rows: number;
  input: string[];
  streams: Set<ReadableStreamDefaultController<Uint8Array>>;
}

export class FakeShell implements ShellClient {
  readonly ptys = new Map<string, FakePty>();
  readonly attachCalls: Array<{ id: string; options: PtyAttachOptions | undefined }> = [];
  readonly acknowledged: number[] = [];
  private next = 0;
  private attachments = 0;

  create(): string {
    const id = `pty-${++this.next}`;
    this.ptys.set(id, {
      output: new Uint8Array(0),
      alive: true,
      cols: 80,
      rows: 24,
      input: [],
      streams: new Set(),
    });
    return id;
  }

  pty(id: string): FakePty {
    const pty = this.ptys.get(id);
    if (!pty) throw Object.assign(new Error(`No shell session ${id}`), { code: "ENOENT" });
    return pty;
  }

  /** The program writes output. */
  emit(id: string, text: string): void {
    const pty = this.pty(id);
    const bytes = encoder.encode(text);
    const at = pty.output.byteLength;
    const merged = new Uint8Array(at + bytes.byteLength);
    merged.set(pty.output);
    merged.set(bytes, at);
    pty.output = merged;
    for (const stream of pty.streams) send(stream, { kind: "data", at, bytes });
  }

  /** The program exits. */
  exit(id: string, code: number | null): void {
    const pty = this.pty(id);
    pty.alive = false;
    pty.exit = { code };
    for (const stream of pty.streams) {
      send(stream, { kind: "exit", code });
      stream.close();
    }
    pty.streams.clear();
  }

  /** Every attachment's transport drops (the server connection was lost). */
  dropAttachments(): void {
    for (const pty of this.ptys.values()) {
      for (const stream of pty.streams) stream.error(new Error("connection lost"));
      pty.streams.clear();
    }
  }

  async attach(id: string, options?: PtyAttachOptions): Promise<Response> {
    this.attachCalls.push({ id, options });
    const pty = this.pty(id);
    if (options?.size) {
      pty.cols = options.size.cols;
      pty.rows = options.size.rows;
    }
    const from = options?.after?.cursor ?? 0;
    const attachId = `attach-${++this.attachments}`;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
      },
      cancel: () => {
        pty.streams.delete(controller);
      },
    });
    send(controller, {
      kind: "hello",
      attachId,
      epoch: 1,
      start: 0,
      cursor: pty.output.byteLength,
      alive: pty.alive,
      cols: pty.cols,
      rows: pty.rows,
    });
    if (pty.output.byteLength > from) {
      send(controller, { kind: "data", at: from, bytes: pty.output.slice(from) });
    }
    if (pty.alive) pty.streams.add(controller);
    else {
      send(controller, { kind: "exit", code: pty.exit?.code ?? null });
      controller.close();
    }
    return new Response(body);
  }

  async acknowledge(_id: string, _attachId: string, bytes: number): Promise<void> {
    this.acknowledged.push(bytes);
  }

  async write(id: string, data: string): Promise<void> {
    this.pty(id).input.push(data);
  }

  async resize(id: string, cols: number, rows: number): Promise<void> {
    const pty = this.pty(id);
    pty.cols = cols;
    pty.rows = rows;
  }

  /** Everything the program received as input, joined. */
  typed(id: string): string {
    return this.pty(id).input.join("");
  }
}

function send(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: Parameters<typeof encodePtyStreamEvent>[0]
): void {
  for (const frame of encodePtyStreamEvent(event)) controller.enqueue(frame);
}

/** The terminal launch service: the person's session registry, over a {@link FakeShell}. */
export class FakeTerminalSessions implements TerminalSessions, TerminalSettingsStore {
  readonly entries = new Map<string, TerminalSessionEntry>();
  readonly launches: LaunchRequest[] = [];
  readonly closed: string[] = [];
  settings: Record<string, unknown> = {};
  /** When set, launch and resume fail with it. */
  failure: Error | null = null;
  private listeners = new Set<(sessions: TerminalSessionEntry[]) => void>();
  private next = 0;
  private clock = 1000;

  constructor(
    readonly shell: FakeShell,
    private readonly apps: Record<string, { title: string; icon?: string }> = {}
  ) {}

  /** A session as if started earlier (on this or another device). */
  add(
    partial: Partial<TerminalSessionEntry> & Pick<TerminalSessionEntry, "title">
  ): TerminalSessionEntry {
    const entry: TerminalSessionEntry = {
      sessionId: `term-${++this.next}`,
      kind: "shell",
      shellSessionId: this.shell.create(),
      running: true,
      createdAt: this.clock,
      lastActiveAt: ++this.clock,
      ...partial,
    };
    this.entries.set(entry.sessionId, entry);
    return entry;
  }

  /** The program of a session exits. */
  exit(sessionId: string, code: number): void {
    const entry = this.entries.get(sessionId)!;
    this.shell.exit(entry.shellSessionId!, code);
    this.update(sessionId, { running: false, exit: { code } });
  }

  update(sessionId: string, patch: Partial<TerminalSessionEntry>): void {
    this.entries.set(sessionId, { ...this.entries.get(sessionId)!, ...patch });
    this.changed();
  }

  remove(sessionId: string): void {
    this.entries.delete(sessionId);
    this.changed();
  }

  async list(): Promise<TerminalSessionEntry[]> {
    return [...this.entries.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  async launch(request: LaunchRequest): Promise<TerminalSessionEntry> {
    this.launches.push(request);
    if (this.failure) throw this.failure;
    const app = request.source ? this.apps[request.source] : undefined;
    const entry = this.add({
      kind: request.source ? "app" : "shell",
      title: app?.title ?? "Shell",
      ...(request.source
        ? { source: request.source, principalId: `code:${request.source}:${this.next + 1}` }
        : {}),
      ...(app?.icon ? { icon: app.icon } : {}),
    });
    this.changed();
    return entry;
  }

  async resume(request: { sessionId: string }): Promise<TerminalSessionEntry> {
    if (this.failure) throw this.failure;
    const entry = this.entries.get(request.sessionId)!;
    if (entry.running) return entry;
    const relaunched: TerminalSessionEntry = {
      ...entry,
      shellSessionId: this.shell.create(),
      running: true,
      lastActiveAt: ++this.clock,
    };
    delete relaunched.exit;
    this.entries.set(entry.sessionId, relaunched);
    this.changed();
    return relaunched;
  }

  async close(sessionId: string): Promise<void> {
    this.closed.push(sessionId);
    this.remove(sessionId);
  }

  onChange(listener: (sessions: TerminalSessionEntry[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getSettings(): Promise<Record<string, unknown>> {
    return this.settings;
  }

  async setSettings(settings: Record<string, unknown>): Promise<void> {
    this.settings = settings;
  }

  private changed(): void {
    const sessions = [...this.entries.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    queueMicrotask(() => {
      for (const listener of [...this.listeners]) listener(sessions);
    });
  }
}
