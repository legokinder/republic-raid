import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRaid } from '../scripts/raid-status.mjs';

const now = Date.parse('2026-09-28T09:00:00.000Z');
const unsubmitted = {
  hasSubmitted: false,
  hasJoined: false,
  submissionStatus: null,
  status: 'active',
  expiresAt: '2026-09-28T10:00:00.000Z',
};

test('unjoined, active, unexpired raids are not submitted', () => {
  assert.equal(classifyRaid(unsubmitted, now), 'not_submitted');
});

test('joining without a submission requires reconciliation of unknown prior activity', () => {
  assert.equal(classifyRaid({ ...unsubmitted, hasJoined: true }, now), 'reconcile_required');
});

test('server submission states remain authoritative after raid expiry', () => {
  for (const [submissionStatus, expected] of [['completed', 'approved'], ['submitted', 'pending_review']]) {
    assert.equal(classifyRaid({
      ...unsubmitted,
      hasJoined: true,
      hasSubmitted: true,
      submissionStatus,
      status: 'inactive',
      expiresAt: '2026-09-27T00:00:00.000Z',
    }, now), expected);
  }
});

test('rejections, requested changes, and unknown submission states need review', () => {
  for (const submissionStatus of ['rejected', 'changes_requested', 'unknown', null, undefined]) {
    assert.equal(classifyRaid({ ...unsubmitted, hasJoined: true, hasSubmitted: true, submissionStatus }, now), 'needs_review');
  }
});

test('conflicting flags or submission status never permit a new submission', () => {
  assert.equal(classifyRaid({ ...unsubmitted, hasSubmitted: true, submissionStatus: 'completed' }, now), 'needs_review');
  for (const submissionStatus of ['submitted', 'completed', 'rejected', '', undefined]) {
    assert.equal(classifyRaid({ ...unsubmitted, submissionStatus }, now), 'needs_review');
  }
});

test('missing or nonboolean flags need review, including incomplete request outcomes', () => {
  for (const field of ['hasSubmitted', 'hasJoined']) {
    for (const value of [undefined, null, 'false', 0]) {
      assert.equal(classifyRaid({ ...unsubmitted, [field]: value }, now), 'needs_review');
    }
  }
  assert.equal(classifyRaid(null, now), 'needs_review');
  assert.equal(classifyRaid({}, now), 'needs_review');
});

test('inactive or expired raids are unavailable, including the exact expiry instant', () => {
  assert.equal(classifyRaid({ ...unsubmitted, status: 'inactive' }, now), 'unavailable');
  for (const expiresAt of ['2026-09-28T08:59:59.999Z', '2026-09-28T09:00:00.000Z']) {
    assert.equal(classifyRaid({ ...unsubmitted, expiresAt }, now), 'unavailable');
  }
  assert.equal(classifyRaid({ ...unsubmitted, expiresAt: '2026-09-28T09:00:00.001Z' }, now), 'not_submitted');
});

test('invalid dates and missing activity status need review', () => {
  for (const expiresAt of [undefined, null, '', 'not-a-date', 0, '1', '2026-09-29', '2026-02-30T10:00:00Z', '2026-09-28T24:00:00Z']) {
    assert.equal(classifyRaid({ ...unsubmitted, expiresAt }, now), 'needs_review');
  }
  for (const invalidNow of [null, '2026-09-28', NaN, Infinity, -Infinity, 9e15]) {
    assert.equal(classifyRaid(unsubmitted, invalidNow), 'needs_review');
  }
  for (const status of [undefined, null, '', ' ']) {
    assert.equal(classifyRaid({ ...unsubmitted, status }, now), 'needs_review');
  }
});

test('ISO timezone offsets and leap dates are valid', () => {
  assert.equal(classifyRaid({ ...unsubmitted, expiresAt: '2026-09-28T19:00:00+09:00' }, now), 'not_submitted');
  assert.equal(classifyRaid({ ...unsubmitted, expiresAt: '2028-02-29T00:00:00Z' }, now), 'not_submitted');
});
