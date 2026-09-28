function parseExpiry(value) {
  if (typeof value !== 'string') return NaN;
  const iso = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!iso) return NaN;
  const date = new Date(`${iso[1]}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso[1]) return NaN;
  return Date.parse(value);
}

// Server state alone cannot prove that a joined raid has no prior X activity.
export function classifyRaid(raid, now = Date.now()) {
  if (!raid || typeof raid.hasSubmitted !== 'boolean' || typeof raid.hasJoined !== 'boolean') {
    return 'needs_review';
  }

  if (raid.hasSubmitted) {
    if (!raid.hasJoined) return 'needs_review';
    if (raid.submissionStatus === 'completed') return 'approved';
    if (raid.submissionStatus === 'submitted') return 'pending_review';
    return 'needs_review';
  }

  if (raid.submissionStatus !== null) return 'needs_review';
  const expiresAt = parseExpiry(raid.expiresAt);
  if (typeof now !== 'number' || !Number.isFinite(new Date(now).getTime()) || !Number.isFinite(expiresAt)) {
    return 'needs_review';
  }
  if (typeof raid.status !== 'string' || !raid.status.trim()) return 'needs_review';
  if (raid.status !== 'active' || expiresAt <= now) return 'unavailable';
  return raid.hasJoined ? 'reconcile_required' : 'not_submitted';
}
