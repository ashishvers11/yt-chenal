/**
 * Firestore Security Rules Specification Test Suite
 * Verifies that all "Dirty Dozen" adversarial payloads defined in security_spec.md
 * are rejected with PERMISSION_DENIED by the fortress rule logic.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: {
    uid: string;
    email: string;
    email_verified: boolean;
  } | null;
  docId: string;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED' | 'ALLOWED';
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Workspace Create',
    collection: 'workspaces',
    operation: 'create',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    docId: 'ws_1',
    payload: { workspaceId: 'ws_1', ownerUid: 'user_b', channelId: 'UC123', workspaceName: 'Spoof', mode: 'standard' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Self-Assigned Super Admin Role',
    collection: 'users',
    operation: 'create',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    docId: 'user_a',
    payload: { uid: 'user_a', displayName: 'Attacker', email: 'a@example.com', role: 'super_admin', status: 'active' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Unverified Admin Email Spoof',
    collection: 'users',
    operation: 'get',
    auth: { uid: 'spoof_uid', email: 'anishakumari136x@gmail.com', email_verified: false },
    docId: 'victim_uid',
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow Field Injection on Script Update',
    collection: 'scripts',
    operation: 'update',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    docId: 'scr_1',
    payload: { isFeaturedGhostField: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Cross-Tenant Report Read',
    collection: 'researchReports',
    operation: 'get',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    docId: 'rep_owned_by_b',
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Cross-Tenant List Scraping on ContentIdeas',
    collection: 'contentIdeas',
    operation: 'list',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    docId: '',
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'ID Poisoning Attack',
    collection: 'projects',
    operation: 'create',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    docId: 'invalid$id!with*spaces',
    payload: { projectId: 'invalid$id!with*spaces', ownerUid: 'user_a' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Denial-of-Wallet String Overflow',
    collection: 'contentIdeas',
    operation: 'create',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    docId: 'idea_1',
    payload: { title: 'A'.repeat(5000) },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Immortal Field Mutation (ownerUid / createdAt)',
    collection: 'workspaces',
    operation: 'update',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    docId: 'ws_1',
    payload: { ownerUid: 'user_b' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Orphaned Child Creation without Valid Parent Workspace',
    collection: 'contentIdeas',
    operation: 'create',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    docId: 'idea_orphan',
    payload: { workspaceId: 'non_existent_ws', ownerUid: 'user_a' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'PII Blanket Read on Users Collection',
    collection: 'users',
    operation: 'get',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    docId: 'user_b',
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Value Poisoning on Update (Invalid Enum)',
    collection: 'contentIdeas',
    operation: 'update',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    docId: 'idea_1',
    payload: { status: 'hacked_enum_value' },
    expectedResult: 'PERMISSION_DENIED',
  },
];
