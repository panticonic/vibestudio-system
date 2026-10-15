/** Globals supplied by this app's existing setupGlobals and URL/random-values
 * imports. This is the native app environment, not the Node/Jest environment. */
export {};
declare global {
  var process: {
    env: Record<string, string | undefined>;
    cwd(): string;
  };
  type NativeRandomArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array;
  var crypto: {
    getRandomValues<T extends NativeRandomArray>(array: T): T;
    randomUUID(): string;
  };
  interface URL {
    hash: string;
    host: string;
    hostname: string;
    readonly origin: string;
    password: string;
    pathname: string;
    port: string;
    protocol: string;
    search: string;
    username: string;
  }
  interface URLSearchParams {
    delete(name: string): void;
    get(name: string): string | null;
    getAll(name: string): string[];
    has(name: string): boolean;
    set(name: string, value: string): void;
    sort(): void;
    entries(): IterableIterator<[string, string]>;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    forEach(
      callback: (value: string, key: string, parent: URLSearchParams) => void,
      thisArg?: unknown,
    ): void;
  }
}
