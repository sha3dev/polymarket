export function clamp(value: number, minimum: number, maximum: number): number {
  const result = Math.max(minimum, Math.min(maximum, value));
  return result;
}

export function round(value: number, decimals = 0): number {
  const multiplier = 10 ** decimals;
  const result = Math.round((value + Number.EPSILON) * multiplier) / multiplier;
  return result;
}

export function decodeWsMessage(data: unknown): string {
  let text = "";
  if (typeof data === "string") {
    text = data;
  } else if (Buffer.isBuffer(data)) {
    text = data.toString("utf8");
  } else if (Array.isArray(data)) {
    text = Buffer.concat(data).toString("utf8");
  } else if (data instanceof ArrayBuffer) {
    text = Buffer.from(data).toString("utf8");
  } else {
    text = String(data);
  }
  return text;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  const result = typeof value === "object" && value !== null;
  return result;
}

export function asArray<T>(value: T | T[]): T[] {
  const result = Array.isArray(value) ? value : [value];
  return result;
}
