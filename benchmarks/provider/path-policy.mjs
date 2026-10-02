export function findForbiddenSourceOnlyPaths(paths) {
  if (!Array.isArray(paths)) {
    throw new Error('candidate paths must be an array');
  }

  const forbidden = new Set();

  for (const value of paths) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error('candidate path must be a non-empty string');
    }

    const portable = value.trim().replaceAll('\\', '/');
    const parts = portable.split('/').filter(Boolean);
    const basename = (parts.at(-1) ?? '').toLowerCase();
    const lowerParts = parts.map((part) => part.toLowerCase());

    const isTestPath =
      lowerParts.includes('test') ||
      lowerParts.includes('tests') ||
      lowerParts.includes('r2e_tests') ||
      basename === 'conftest.py' ||
      /^test_/.test(basename) ||
      /_test\.(py|js|jsx|ts|tsx|go|rs)$/.test(basename);

    const isHiddenAuthority =
      portable === '.archeagent-hidden' ||
      portable.startsWith('.archeagent-hidden/');

    if (isTestPath || isHiddenAuthority) {
      forbidden.add(portable);
    }
  }

  return [...forbidden].sort();
}
