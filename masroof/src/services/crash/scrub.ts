/**
 * Crash-report scrubber (ADR-017). Builds a NEW event from an allow-list, so
 * anything not listed here — including fields a future SDK adds — is
 * dropped. Messages are replaced by the error type: an SQL error or a
 * validation message could quote an amount, note or payee.
 */
type Frame = {
  filename?: unknown;
  function?: unknown;
  lineno?: unknown;
  colno?: unknown;
  in_app?: unknown;
};

export type ScrubbedFrame = {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
};

export type ScrubbedEvent = {
  event_id?: string;
  timestamp?: number;
  level?: string;
  platform?: string;
  release?: string;
  environment?: string;
  exception?: {
    values: {
      type: string;
      value: string;
      mechanism?: { type: string; handled?: boolean };
      stacktrace?: { frames: ScrubbedFrame[] };
    }[];
  };
  contexts?: { os?: { name?: string; version?: string } };
};

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** Basename only: full paths can include a user or device name. */
function basename(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const clean = path.split('?')[0] ?? path;
  return clean.slice(Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\')) + 1);
}

/** Error type names are identifiers; anything else is replaced. */
function safeType(v: unknown): string {
  const s = str(v);
  return s && /^[A-Za-z_$][\w$.]{0,63}$/.test(s) ? s : 'Error';
}

function frame(f: Frame): ScrubbedFrame {
  const out: ScrubbedFrame = {};
  const filename = basename(str(f.filename));
  if (filename) out.filename = filename;
  const fn = str(f.function);
  if (fn && /^[\w$.<>@ \-[\]]{1,128}$/.test(fn)) out.function = fn;
  const lineno = num(f.lineno);
  if (lineno !== undefined) out.lineno = lineno;
  const colno = num(f.colno);
  if (colno !== undefined) out.colno = colno;
  if (typeof f.in_app === 'boolean') out.in_app = f.in_app;
  return out;
}

export function scrubEvent(event: unknown): ScrubbedEvent {
  const e = obj(event);
  const out: ScrubbedEvent = {};
  for (const key of ['event_id', 'level', 'platform', 'release', 'environment'] as const) {
    const v = str(e[key]);
    if (v) out[key] = v;
  }
  const ts = num(e.timestamp);
  if (ts !== undefined) out.timestamp = ts;

  const values = obj(e.exception).values;
  if (Array.isArray(values)) {
    out.exception = {
      values: values.map((raw) => {
        const v = obj(raw);
        const type = safeType(v.type);
        const mech = obj(v.mechanism);
        const frames = obj(v.stacktrace).frames;
        return {
          type,
          value: type, // the message itself never leaves the device
          ...(str(mech.type)
            ? {
                mechanism: {
                  type: safeType(mech.type),
                  ...(typeof mech.handled === 'boolean' ? { handled: mech.handled } : {}),
                },
              }
            : {}),
          ...(Array.isArray(frames)
            ? { stacktrace: { frames: frames.map((f) => frame(obj(f))) } }
            : {}),
        };
      }),
    };
  }

  const os = obj(obj(e.contexts).os);
  const osName = str(os.name);
  const osVersion = str(os.version);
  if (osName || osVersion) {
    out.contexts = {
      os: { ...(osName ? { name: osName } : {}), ...(osVersion ? { version: osVersion } : {}) },
    };
  }
  return out;
}
