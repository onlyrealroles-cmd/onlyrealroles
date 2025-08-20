// functions/index.js — OnlyRealRoles (Node 18, Functions v2)

const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { setGlobalOptions, logger } = require('firebase-functions/v2/options');

// ---------- Global options ----------
setGlobalOptions({
  region: 'us-central1',
  memoryMiB: 256,
  maxInstances: 50,
});

// ---------- Helpers ----------
const EVENT_BADGES = {
  FIRST_REPORT: 'Polter-Position Spotter',
  FIVE_APPROVALS: 'Revealer',
};

const POINT_BADGES = [
  [5000, 'Golden Guide'],
  [2000, 'Eternal Echo'],
  [1000, "That's... a thousand..."],
  [500, 'Nightly Knight'],
  [200, 'Apparition Avoider'],
  [100, 'Phantom Fighter'],
  [50, 'Wraith Wrecker'],
  [25, 'Soul Saver'],
  [10, 'Whisp Whisperer'],
];

function union(arr, ...items) {
  return Array.from(new Set([...(arr || []), ...items.filter(Boolean)]));
}

function asType(v) {
  if (v === 'valid' || v === 1) return 'valid';
  if (v === 'needs_more' || v === 0) return 'needs_more';
  if (v === 'invalid' || v === -1) return 'invalid';
  return null;
}

/**
 * Award badges & counters atomically on users/{uid}.
 * - reportsCountDelta: +1 when a ghost report is created by the user.
 * - approvalsDelta: +1/-1 when their report gains/loses a 'valid' vote.
 */
async function awardBadgesIfNeeded(userRef, { reportsCountDelta = 0, approvalsDelta = 0 }) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const u = snap.exists ? snap.data() : {};

    const reportsCount   = (u.reportsCount   || 0) + reportsCountDelta;
    const approvalsCount = (u.approvalsCount || 0) + approvalsDelta;

    // Points: we keep both keys since your UI reads either
    const accountPoints = (u.accountPoints || 0) + approvalsDelta;
    const points        = (u.points        || 0) + approvalsDelta;

    let earned = u.earnedBadges || [];

    // Event badges
    if ((u.reportsCount || 0) === 0 && reportsCount > 0) {
      earned = union(earned, EVENT_BADGES.FIRST_REPORT);
    }
    if ((u.approvalsCount || 0) < 5 && approvalsCount >= 5) {
      earned = union(earned, EVENT_BADGES.FIVE_APPROVALS);
    }

    // Point threshold badges
    for (const [threshold, badge] of POINT_BADGES) {
      if ((u.accountPoints || 0) < threshold && accountPoints >= threshold) {
        earned = union(earned, badge);
      }
    }

    tx.set(
      userRef,
      {
        reportsCount,
        approvalsCount,
        accountPoints,
        points,
        earnedBadges: earned,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

// ======================================================================
// 1) ghost_reports — report creation: increment author's reportsCount
// ======================================================================
exports.onGhostReportCreate = onDocumentCreated('ghost_reports/{reportId}', async (event) => {
  const data = event.data?.data();
  if (!data) return;
  const authorUid = data.uid; // ghost_reports docs store the author in 'uid'
  if (!authorUid) return;

  const userRef = db.doc(`users/${authorUid}`);
  await awardBadgesIfNeeded(userRef, { reportsCountDelta: 1 });
});

// ======================================================================
// 2) ghost_reports — votes: award/remove points when vote toggles 'valid'
// ======================================================================
exports.onGhostReportVoteWrite = onDocumentWritten('ghost_reports/{reportId}/votes/{voterId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after  = event.data.after.exists  ? event.data.after.data()  : null;

  const prevType = asType(before?.value);
  const nextType = asType(after?.value);

  // No change in semantic value -> nothing to do
  if (prevType === nextType) return;

  const { reportId, voterId } = event.params;

  // Look up report to get author
  const reportRef = db.doc(`ghost_reports/${reportId}`);
  const reportSnap = await reportRef.get();
  if (!reportSnap.exists) return;
  const report = reportSnap.data();
  const authorUid = report?.uid;
  if (!authorUid) return;

  // Do not award for self-votes
  if (authorUid === voterId) return;

  // We only award points for 'valid' transitions.
  // +1 when moving to 'valid'; -1 when moving away from 'valid'
  const delta = (nextType === 'valid' ? 1 : 0) - (prevType === 'valid' ? 1 : 0);
  if (delta === 0) return;

  const userRef   = db.doc(`users/${authorUid}`);
  const ledgerRef = db.doc(`users/${authorUid}/point_ledger/${reportId}_${voterId}`);

  // Idempotent update via per-(report,voter) ledger so retries can't double-apply
  await db.runTransaction(async (tx) => {
    const ledger = await tx.get(ledgerRef);
    const lastIsValid = ledger.exists ? !!ledger.get('lastIsValid') : false;
    const effectiveDelta = (nextType === 'valid' ? 1 : 0) - (lastIsValid ? 1 : 0);
    if (effectiveDelta === 0) return;

    tx.set(
      ledgerRef,
      {
        reportId,
        voterId,
        lastIsValid: nextType === 'valid',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Update both fields so your pill (accountPoints ?? points) always works
    tx.set(
      userRef,
      {
        accountPoints: FieldValue.increment(effectiveDelta),
        points: FieldValue.increment(effectiveDelta),
        approvalsCount: FieldValue.increment(effectiveDelta),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
});

// ======================================================================
// 3) network_posts — maintain aggregate vote counters (optional utility)
// ======================================================================
exports.onNetworkPostVoteWrite = onDocumentWritten('network_posts/{postId}/votes/{userId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null; // { value: -1|0|1 }
  const after  = event.data.after.exists  ? event.data.after.data()  : null;

  const oldVal = before?.value ?? 0;
  const newVal = after?.value  ?? 0;

  // Deltas for parent counters
  const deltaUp   = (newVal === 1 ? 1 : 0) - (oldVal === 1 ? 1 : 0);
  const deltaDown = (newVal === -1 ? 1 : 0) - (oldVal === -1 ? 1 : 0);
  if (deltaUp === 0 && deltaDown === 0) return;

  const { postId } = event.params;
  const postRef = db.doc(`network_posts/${postId}`);

  await postRef.set(
    {
      votesUp: FieldValue.increment(deltaUp),
      votesDown: FieldValue.increment(deltaDown),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
});
