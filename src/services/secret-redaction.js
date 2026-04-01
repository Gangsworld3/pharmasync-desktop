const SENSITIVE_KEY_PATTERN = /(password|secret|token|authorization|api[_-]?key|cookie|jwt|access[_-]?token|refresh[_-]?token)/i;

function redactString(value) {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }

  let redacted = value;
  redacted = redacted.replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, "$1[REDACTED]");
  redacted = redacted.replace(/(postgres(?:ql(?:\+psycopg)?)?:\/\/[^:\s]+:)[^@\/\s]+@/gi, "$1[REDACTED]@");
  redacted = redacted.replace(/(rediss?:\/\/[^:\/\s]+:)[^@\/\s]+@/gi, "$1[REDACTED]@");
  redacted = redacted.replace(/((?:password|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
  redacted = redacted.replace(/((?:password|secret|token|api[_-]?key)=)[^&\s]+/gi, "$1[REDACTED]");

  return redacted;
}

export function redactSecrets(value, keyHint = "") {
  if (SENSITIVE_KEY_PATTERN.test(String(keyHint))) {
    return "[REDACTED]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, redactSecrets(nested, key)])
    );
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  return value;
}
