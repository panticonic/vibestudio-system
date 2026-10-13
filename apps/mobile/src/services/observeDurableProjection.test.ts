import { observeDurableProjection } from "./observeDurableProjection";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const flush = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

it("listens before reading and discards a read superseded by a change", async () => {
  const old = deferred<string>();
  const current = deferred<string>();
  let changed!: () => void;
  const apply = jest.fn();
  const read = jest
    .fn<Promise<string>, []>()
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);

  const observation = observeDurableProjection({
    listen: (listener) => {
      changed = listener;
      return jest.fn();
    },
    read,
    apply,
    error: jest.fn(),
  });

  expect(read).toHaveBeenCalledTimes(1);
  changed();
  old.resolve("stale");
  await flush();
  expect(apply).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(2);
  current.resolve("current");
  await flush();
  expect(apply).toHaveBeenCalledWith("current");
  observation.stop();
});

it("does not publish a read after its owner stops", async () => {
  const pending = deferred<string>();
  const apply = jest.fn();
  const unlisten = jest.fn();
  const observation = observeDurableProjection({
    listen: () => unlisten,
    read: () => pending.promise,
    apply,
    error: jest.fn(),
  });

  observation.stop();
  pending.resolve("late");
  await flush();
  expect(unlisten).toHaveBeenCalledTimes(1);
  expect(apply).not.toHaveBeenCalled();
});

it("keeps recovery pending for the authoritative read and preserves failure", async () => {
  const pending = deferred<string>();
  let refresh!: () => Promise<void>;
  const failure = new Error("projection unavailable");
  const error = jest.fn();
  const observation = observeDurableProjection({
    listen: (changed) => {
      refresh = changed;
      return jest.fn();
    },
    read: jest
      .fn<Promise<string>, []>()
      .mockResolvedValueOnce("initial")
      .mockReturnValueOnce(pending.promise),
    apply: jest.fn(),
    error,
  });
  await flush();

  const recovery = refresh();
  let settled = false;
  void recovery.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await flush();
  expect(settled).toBe(false);
  pending.reject(failure);
  await expect(recovery).rejects.toBe(failure);
  expect(error).toHaveBeenCalledWith(failure);
  observation.stop();
});

it("admits the watch before reading and folds an event during admission into the read", async () => {
  const admission = deferred<void>();
  let changed!: () => Promise<void>;
  const read = jest.fn(async () => "current");
  const apply = jest.fn();
  const observation = observeDurableProjection({
    listen: (listener) => {
      changed = listener;
      return jest.fn();
    },
    admit: () => admission.promise,
    leave: jest.fn(async () => undefined),
    read,
    apply,
    error: jest.fn(),
  });

  const eventReceipt = changed();
  expect(read).not.toHaveBeenCalled();
  admission.resolve();
  await observation.ready;
  await eventReceipt;
  expect(read).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledWith("current");
  observation.stop();
});
