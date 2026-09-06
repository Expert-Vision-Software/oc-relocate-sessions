const pendingWrites: Promise<void>[] = [];

function track(stream: { write: (chunk: string, cb?: (error?: Error | null) => void) => unknown }, text: string): void {
  pendingWrites.push(
    new Promise<void>((resolve) => {
      stream.write(text, () => resolve());
    }),
  );
}

export function writeOut(text: string): void {
  track(process.stdout, text);
}

export function writeErr(text: string): void {
  track(process.stderr, text);
}

export async function flushOutput(): Promise<void> {
  const pending = pendingWrites.splice(0, pendingWrites.length);
  await Promise.all(pending);
}
