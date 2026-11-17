import crypto from "crypto";
import { computeTextSignals } from "./features.ts";
import type { CanonicalRequestRecord } from "./types.ts";

export const MAX_REQUEST_BODY_BYTES = 65536;

const SENSITIVE_HEADER_KEYS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-admin-token",
  "x-auth-token",
]);

const SENSITIVE_FIELD_KEYS = new Set([
  "password",
  "passwd",
  "pass",
  "pwd",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "api_key",
  "apikey",
  "session",
  "session_id",
  "credit_card",
  "cvv",
]);

function redactObject(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.slice(0, 50).map(redactObject);
  }
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_FIELD_KEYS.has(k.toLowerCase())) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactObject(v);
      }
    }
    return out;
  }
  return obj;
}

export function normalizeHttpRequest(params: {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  rawBody: string;
  source?: string;
}): { record: CanonicalRequestRecord; safeSnippet: string } {
  if (Buffer.byteLength(params.rawBody, "utf8") > MAX_REQUEST_BODY_BYTES) {
    throw new Error(`Request body exceeds ${MAX_REQUEST_BODY_BYTES} byte guardrail`);
  }

  const safeHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(params.headers)) {
    const kl = k.toLowerCase();
    safeHeaders[kl] = SENSITIVE_HEADER_KEYS.has(kl) ? "[REDACTED]" : String(v).slice(0, 256);
  }

  const safeQuery: Record<string, string> = {};
  for (const [k, v] of Object.entries(params.query)) {
    safeQuery[k] = SENSITIVE_FIELD_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : String(v).slice(0, 512);
  }

  const sig = computeTextSignals(params.rawBody);
  const bodyFeatures: Record<string, number> = params.rawBody
    ? {
        body_length: sig.length,
        body_special_char_count: sig.special_char_count,
        body_digit_count: sig.digit_count,
        body_sqli_hits: sig.sqli_keyword_hits,
        body_xss_hits: sig.xss_keyword_hits,
        body_traversal_hits: sig.traversal_hits,
        body_cmd_hits: sig.cmd_injection_hits,
        body_quote_angle_count: sig.quote_and_angle_count,
        body_entropy: sig.entropy,
      }
    : { body_length: 0 };

  let safeBodyPreview = "";
  if (params.rawBody) {
    try {
      const parsed = JSON.parse(params.rawBody);
      safeBodyPreview = JSON.stringify(redactObject(parsed)).slice(0, 260);
    } catch {
      safeBodyPreview = params.rawBody
        .replace(/(password|token|secret|api_key)\s*[=:]\s*[^&\s]+/gi, "$1=[REDACTED]")
        .slice(0, 260);
    }
  }

  const record: CanonicalRequestRecord = {
    request_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    method: params.method.toUpperCase(),
    path: params.path,
    query: safeQuery,
    headers_safe: safeHeaders,
    body_features: bodyFeatures,
    source: params.source ?? "proxy-client",
  };

  const queryPart = Object.keys(safeQuery).length > 0 ? ` query=${JSON.stringify(safeQuery)}` : "";
  const bodyPart = safeBodyPreview ? ` body=${safeBodyPreview}` : "";
  const safeSnippet = `${record.method} ${record.path}${queryPart}${bodyPart}`.slice(0, 480);

  return { record, safeSnippet };
}
