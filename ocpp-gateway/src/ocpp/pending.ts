type Pending = {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();

export function waitForResponse(uniqueId: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(uniqueId);
      reject(new Error(`OCPP call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(uniqueId, { resolve, reject, timer });
  });
}

export function resolveResponse(uniqueId: string, payload: unknown): boolean {
  const entry = pending.get(uniqueId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(uniqueId);
  entry.resolve(payload);
  return true;
}

export function rejectResponse(uniqueId: string, err: Error): boolean {
  const entry = pending.get(uniqueId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(uniqueId);
  entry.reject(err);
  return true;
}
