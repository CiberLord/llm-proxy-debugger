// Model remap with glob-style wildcard support.
//
// Patterns use `*` to match any substring (including empty). Examples:
//   "claude-*"        matches "claude-opus-4-7"
//   "*opus*"          matches "claude-opus-4-7" and "claude-3-opus-20240229"
//   "*"               matches anything (fallback)
//
// Resolution order:
//   1. Exact match (no wildcards).
//   2. Wildcard patterns, in the order they appear in the map.
//   3. Return original model unchanged.

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const withWildcard = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${withWildcard}$`);
}

export function applyModelRemap(
  model: string,
  map: Record<string, string>
): string {
  if (Object.prototype.hasOwnProperty.call(map, model)) return map[model];

  for (const [pattern, target] of Object.entries(map)) {
    if (!pattern.includes("*")) continue;
    if (patternToRegex(pattern).test(model)) return target;
  }

  return model;
}
