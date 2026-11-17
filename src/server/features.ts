export const FEATURE_NAMES = [
  "method_code",
  "path_length",
  "path_depth",
  "is_known_route",
  "query_param_count",
  "query_length",
  "body_length",
  "special_char_count",
  "special_char_ratio",
  "digit_ratio",
  "sqli_keyword_hits",
  "xss_keyword_hits",
  "traversal_hits",
  "cmd_injection_hits",
  "quote_and_angle_count",
  "payload_entropy",
] as const;

export const KNOWN_ROUTES = new Set([
  "/",
  "/health",
  "/login",
  "/search",
  "/products",
  "/api/products",
  "/api/feedback",
]);

const METHOD_MAP: Record<string, number> = {
  GET: 0,
  POST: 1,
  PUT: 2,
  DELETE: 3,
  PATCH: 4,
};

const SQLI_REGEX =
  /(\bunion\b|\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b|\bor\s+1\s*=\s*1\b|\band\s+1\s*=\s*1\b|--|\/\*|\*\/|\bsleep\s*\(|\bbenchmark\s*\(|\bxp_cmdshell\b|'\s*or\s*')/gi;

const XSS_REGEX =
  /(<\s*script|<\/\s*script|onerror\s*=|onload\s*=|onclick\s*=|onmouseover\s*=|javascript\s*:|<\s*img|<\s*svg|<\s*iframe|alert\s*\(|document\.cookie|eval\s*\()/gi;

const TRAVERSAL_REGEX = /(\.\.\/|\.\.\\|%2e%2e%2f|\/etc\/passwd|boot\.ini|win\.ini)/gi;

const CMD_REGEX = /(;\s*(ls|cat|whoami|id|wget|curl|nc|bash|sh)\b|\$\(|`[^`]+`|\|\|\s*\w+)/gi;

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function shannonEntropy(text: string): number {
  if (!text) return 0;
  const freq = new Map<string, number>();
  for (const ch of text) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  const len = text.length;
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return Number(entropy.toFixed(4));
}

export interface TextSignals {
  length: number;
  special_char_count: number;
  digit_count: number;
  sqli_keyword_hits: number;
  xss_keyword_hits: number;
  traversal_hits: number;
  cmd_injection_hits: number;
  quote_and_angle_count: number;
  entropy: number;
}

export function computeTextSignals(rawText: string): TextSignals {
  const decoded = safeDecode(rawText || "");
  let specialChars = 0;
  let digits = 0;
  let quoteAngles = 0;

  for (const ch of decoded) {
    if (!/[a-zA-Z0-9\s]/.test(ch)) {
      specialChars++;
    }
    if (/[0-9]/.test(ch)) {
      digits++;
    }
    if ("'\"`<>;(){}[]".includes(ch)) {
      quoteAngles++;
    }
  }

  return {
    length: decoded.length,
    special_char_count: specialChars,
    digit_count: digits,
    sqli_keyword_hits: (decoded.match(SQLI_REGEX) || []).length,
    xss_keyword_hits: (decoded.match(XSS_REGEX) || []).length,
    traversal_hits: (decoded.match(TRAVERSAL_REGEX) || []).length,
    cmd_injection_hits: (decoded.match(CMD_REGEX) || []).length,
    quote_and_angle_count: quoteAngles,
    entropy: shannonEntropy(decoded),
  };
}

export function extractFeatures(input: Record<string, unknown>): Record<string, number> {
  if (FEATURE_NAMES.every((name) => typeof input[name] === "number")) {
    const out: Record<string, number> = {};
    for (const name of FEATURE_NAMES) {
      out[name] = Number(input[name]);
    }
    return out;
  }

  const method = String(input.method ?? "GET").toUpperCase();
  const rawPath = String(input.path ?? "/");
  const cleanPath = rawPath.split("?")[0];
  const query = (input.query as Record<string, string> | undefined) ?? {};
  const bodyFeatures = (input.body_features as Record<string, number> | undefined) ?? {};

  const queryEntries = Object.entries(query);
  const queryStr = queryEntries.map(([k, v]) => `${k}=${v}`).join("&");
  const combinedUrl = queryStr ? `${cleanPath}?${queryStr}` : cleanPath;
  const urlSig = computeTextSignals(combinedUrl);

  const bodyLen = Number(bodyFeatures.body_length ?? 0);
  const bodySpecial = Number(bodyFeatures.body_special_char_count ?? 0);
  const bodyDigits = Number(bodyFeatures.body_digit_count ?? 0);
  const bodySqli = Number(bodyFeatures.body_sqli_hits ?? 0);
  const bodyXss = Number(bodyFeatures.body_xss_hits ?? 0);
  const bodyTrav = Number(bodyFeatures.body_traversal_hits ?? 0);
  const bodyCmd = Number(bodyFeatures.body_cmd_hits ?? 0);
  const bodyQa = Number(bodyFeatures.body_quote_angle_count ?? 0);
  const bodyEntropy = Number(bodyFeatures.body_entropy ?? 0);

  const totalLen = Math.max(1, urlSig.length + bodyLen);
  const totalSpecial = urlSig.special_char_count + bodySpecial;
  const totalDigits = urlSig.digit_count + bodyDigits;
  const depth = cleanPath.split("/").filter(Boolean).length;

  return {
    method_code: METHOD_MAP[method] ?? 5,
    path_length: cleanPath.length,
    path_depth: depth,
    is_known_route: KNOWN_ROUTES.has(cleanPath) ? 1 : 0,
    query_param_count: queryEntries.length,
    query_length: queryStr.length,
    body_length: bodyLen,
    special_char_count: totalSpecial,
    special_char_ratio: Number((totalSpecial / totalLen).toFixed(4)),
    digit_ratio: Number((totalDigits / totalLen).toFixed(4)),
    sqli_keyword_hits: urlSig.sqli_keyword_hits + bodySqli,
    xss_keyword_hits: urlSig.xss_keyword_hits + bodyXss,
    traversal_hits: urlSig.traversal_hits + bodyTrav,
    cmd_injection_hits: urlSig.cmd_injection_hits + bodyCmd,
    quote_and_angle_count: urlSig.quote_and_angle_count + bodyQa,
    payload_entropy: Number(Math.max(urlSig.entropy, bodyEntropy).toFixed(4)),
  };
}

export function vectorizeFeatures(featureMap: Record<string, number>): number[] {
  return FEATURE_NAMES.map((name) => Number(featureMap[name] ?? 0));
}
