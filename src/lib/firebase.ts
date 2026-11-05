import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { UsageRecord, AuditLog } from '../types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Validate connection to Firestore on boot per Firebase Integration Skill
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// ---------------------------------------------------------------------------
// In-Memory OAuth 2.0 Access Token Cache (Never persisted to localStorage/DB)
// ---------------------------------------------------------------------------

let cachedYouTubeAccessToken: string | null = null;
let grantedYouTubeScopes: string[] = [];

onAuthStateChanged(auth, (user: User | null) => {
  if (!user) {
    cachedYouTubeAccessToken = null;
    grantedYouTubeScopes = [];
  }
});

export function getCachedYouTubeToken(): string | null {
  return cachedYouTubeAccessToken;
}

export function getGrantedYouTubeScopes(): string[] {
  return grantedYouTubeScopes;
}

export function clearYouTubeToken(): void {
  cachedYouTubeAccessToken = null;
  grantedYouTubeScopes = [];
}

export async function signInWithGoogleIdentity(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function connectYouTubeWithOAuth(includeAnalytics: boolean): Promise<{
  user: User;
  accessToken: string;
  scopes: string[];
}> {
  const provider = new GoogleAuthProvider();
  const scopes = ['https://www.googleapis.com/auth/youtube.readonly'];
  if (includeAnalytics) {
    scopes.push('https://www.googleapis.com/auth/yt-analytics.readonly');
  }
  for (const s of scopes) {
    provider.addScope(s);
  }
  provider.setCustomParameters({ prompt: 'consent' });

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Google OAuth did not return an access token for YouTube.');
  }
  cachedYouTubeAccessToken = credential.accessToken;
  grantedYouTubeScopes = scopes;
  return {
    user: result.user,
    accessToken: credential.accessToken,
    scopes,
  };
}

export async function signOutUser(): Promise<void> {
  cachedYouTubeAccessToken = null;
  grantedYouTubeScopes = [];
  await signOut(auth);
}

// ---------------------------------------------------------------------------
// Defensive Payload Validation & ID Generation Helpers
// ---------------------------------------------------------------------------

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

export function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).substring(2, 10);
  const raw = `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
  return VALID_ID_REGEX.test(raw) ? raw : `id_${Date.now()}`;
}

export function clampStr(val: unknown, maxLength: number, fallback = ''): string {
  const s = typeof val === 'string' ? val.trim() : fallback;
  const nonEmpty = s.length > 0 ? s : fallback;
  return nonEmpty.slice(0, maxLength);
}

export async function recordAiUsage(
  uid: string,
  workspaceId: string,
  usage?: {
    provider?: UsageRecord['provider'];
    model?: string;
    operation?: string;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
  }
): Promise<void> {
  if (!usage || !auth.currentUser) return;
  const recordId = makeSafeId('usage');
  const path = `usageRecords/${recordId}`;
  const docData: UsageRecord = {
    recordId,
    uid,
    workspaceId: clampStr(workspaceId, 128, 'global'),
    provider: usage.provider || 'gemini',
    model: clampStr(usage.model || 'gemini-3.8-flash', 120, 'gemini-3.8-flash'),
    operation: clampStr(usage.operation || 'ai_operation', 160, 'ai_operation'),
    inputTokens: Math.max(0, Number(usage.inputTokens || 0)),
    outputTokens: Math.max(0, Number(usage.outputTokens || 0)),
    estimatedCostUsd: Math.max(0, Number(usage.estimatedCostUsd || 0)),
    createdAt: new Date().toISOString(),
  };
  try {
    await setDoc(doc(db, 'usageRecords', recordId), docData);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function recordAuditLog(
  actorUid: string,
  actorEmail: string,
  action: string,
  resource: string,
  details: string
): Promise<void> {
  if (!auth.currentUser) return;
  const logId = makeSafeId('audit');
  const path = `auditLogs/${logId}`;
  const logData: AuditLog = {
    logId,
    actorUid,
    actorEmail: clampStr(actorEmail, 254, 'creator@ash.studio'),
    action: clampStr(action, 160, 'workspace_action'),
    resource: clampStr(resource, 200, 'workspace'),
    details: clampStr(details, 2000, ''),
    createdAt: new Date().toISOString(),
  };
  try {
    await setDoc(doc(db, 'auditLogs', logId), logData);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
};
