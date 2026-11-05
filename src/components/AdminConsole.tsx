import React, { useState, useEffect } from 'react';
import { Shield, UserPlus, Ban, CheckCircle, DollarSign, Activity } from 'lucide-react';
import {
  UserProfile,
  BetaInvitation,
  UsageRecord,
  AuditLog,
} from '../types';
import {
  db,
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  OperationType,
  handleFirestoreError,
  makeSafeId,
  clampStr,
  recordAuditLog,
} from '../lib/firebase';
import { ModuleBanner } from './ModuleBanner';

interface AdminConsoleProps {
  activeTab: 'admin-dashboard' | 'admin-users' | 'admin-invitations' | 'admin-usage';
  adminUid: string;
  adminEmail: string;
}

const MAX_BETA_USERS = 50;

export const AdminConsole: React.FC<AdminConsoleProps> = ({
  activeTab,
  adminUid,
  adminEmail,
}) => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [invitations, setInvitations] = useState<BetaInvitation[]>([]);
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteDailyLimit, setInviteDailyLimit] = useState<number>(50);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [uSnap, iSnap, usgSnap, logSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'invitations')),
        getDocs(collection(db, 'usageRecords')),
        getDocs(collection(db, 'auditLogs')),
      ]);

      setUsers(uSnap.docs.map((d: any) => d.data() as UserProfile));
      setInvitations(iSnap.docs.map((d: any) => d.data() as BetaInvitation));
      setUsageRecords(
        usgSnap.docs
          .map((d: any) => d.data() as UsageRecord)
          .sort((a: UsageRecord, b: UsageRecord) => b.createdAt.localeCompare(a.createdAt))
      );
      setAuditLogs(
        logSnap.docs
          .map((d: any) => d.data() as AuditLog)
          .sort((a: AuditLog, b: AuditLog) => b.createdAt.localeCompare(a.createdAt))
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, [activeTab]);

  const handleCreateInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    if (invitations.filter((i) => i.status !== 'revoked').length >= MAX_BETA_USERS) {
      setStatusMessage('Maximum 50 active beta invitations reached. Revoke an unused invitation first.');
      return;
    }

    const inviteId = makeSafeId('inv');
    const code = `ASH-BETA-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const invDoc: BetaInvitation = {
      inviteId,
      email: clampStr(inviteEmail.toLowerCase(), 254, 'beta@example.com'),
      inviteCode: code,
      status: 'pending',
      invitedBy: adminUid,
      maxDailyAiRequests: Math.max(1, Math.min(5000, Number(inviteDailyLimit || 50))),
      createdAt: now,
      expiresAt: expires,
      updatedAt: now,
    };

    try {
      await setDoc(doc(db, 'invitations', inviteId), invDoc);
      await recordAuditLog(
        adminUid,
        adminEmail,
        'beta_invitation_created',
        `invitations/${inviteId}`,
        `Invited ${invDoc.email} with code ${code}`
      );
      setInviteEmail('');
      setStatusMessage(`Beta invitation created for ${invDoc.email} (Code: ${code})`);
      await loadAdminData();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `invitations/${inviteId}`);
    }
  };

  const handleToggleInviteStatus = async (
    inv: BetaInvitation,
    nextStatus: BetaInvitation['status']
  ) => {
    const path = `invitations/${inv.inviteId}`;
    try {
      await updateDoc(doc(db, 'invitations', inv.inviteId), {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      });
      await recordAuditLog(
        adminUid,
        adminEmail,
        `invitation_${nextStatus}`,
        path,
        `Updated invitation for ${inv.email} to ${nextStatus}`
      );
      await loadAdminData();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleUpdateUserAccount = async (
    u: UserProfile,
    nextStatus: UserProfile['status'],
    nextDailyLimit: number
  ) => {
    const path = `users/${u.uid}`;
    const updatedDoc: UserProfile = {
      ...u,
      status: nextStatus,
      dailyAiLimit: Math.max(0, Math.min(10000, nextDailyLimit)),
      updatedAt: new Date().toISOString(),
    };
    try {
      await setDoc(doc(db, 'users', u.uid), updatedDoc);
      await recordAuditLog(
        adminUid,
        adminEmail,
        'admin_user_update',
        path,
        `Set ${u.email} status=${nextStatus}, dailyAiLimit=${nextDailyLimit}`
      );
      await loadAdminData();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const totalInputTokens = usageRecords.reduce((acc, r) => acc + (r.inputTokens || 0), 0);
  const totalOutputTokens = usageRecords.reduce((acc, r) => acc + (r.outputTokens || 0), 0);
  const totalEstimatedCost = usageRecords.reduce((acc, r) => acc + (r.estimatedCostUsd || 0), 0);
  const activeBetaSeats = users.filter((u) => u.status === 'active').length;

  return (
    <div>
      <ModuleBanner
        title="Super Admin Governance & 50-User Beta Control Center"
        whatItDoes="Manages private beta invitations (capped at 50 active creators), per-account AI usage quotas, Gemini token cost telemetry, and system security audit logs."
        whyItMatters="Enforces strict cost governance during the 50-user beta while respecting creator data isolation (Super Admin never accesses private creator YouTube tokens or private scripts)."
        howToUse="Use the tabs or sections below to issue/revoke beta invites, adjust daily AI limits per creator, and audit API consumption."
      />

      {statusMessage && (
        <div className="mb-6 p-4 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-xs text-emerald-800 dark:text-emerald-300">
          {statusMessage}
        </div>
      )}

      {/* Top KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="text-xs text-slate-500">Beta Seat Capacity</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {activeBetaSeats} / {MAX_BETA_USERS}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {invitations.filter((i) => i.status === 'pending').length} pending invitations
          </div>
        </div>

        <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="text-xs text-slate-500">Total Gemini Tokens Processed</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {(totalInputTokens + totalOutputTokens).toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
            In: {totalInputTokens.toLocaleString()} · Out: {totalOutputTokens.toLocaleString()}
          </div>
        </div>

        <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="text-xs text-slate-500">Estimated AI API Spend</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            ${totalEstimatedCost.toFixed(4)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
            Avg per user: ${(totalEstimatedCost / Math.max(1, activeBetaSeats)).toFixed(4)}
          </div>
        </div>

        <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="text-xs text-slate-500">Security & Privacy Isolation</div>
          <div className="mt-1 text-base font-bold text-emerald-600 dark:text-emerald-400">
            Zero-Trust Rules Enforced
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {auditLogs.length} immutable audit events logged
          </div>
        </div>
      </div>

      {/* Beta Invitation Manager */}
      {(activeTab === 'admin-dashboard' || activeTab === 'admin-invitations') && (
        <div className="mb-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Private Beta Invitation System (50-User Cap)
              </h2>
              <p className="text-xs text-slate-500">
                Issue invitation codes for beta creators and set their initial daily AI request allowance.
              </p>
            </div>
          </div>

          <form onSubmit={handleCreateInvitation} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Creator Email (e.g., creator@youtube.com)"
                className="w-full px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              />
            </div>
            <div>
              <input
                type="number"
                min={5}
                max={1000}
                value={inviteDailyLimit}
                onChange={(e) => setInviteDailyLimit(Number(e.target.value))}
                placeholder="Daily AI Limit"
                className="w-full px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg tabular-nums"
              />
            </div>
            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg whitespace-nowrap shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Send Beta Invite</span>
              </button>
            </div>
          </form>

          {invitations.length > 0 && (
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                    <th className="py-2.5 px-4 font-semibold">Invited Email</th>
                    <th className="py-2.5 px-4 font-semibold">Invite Code</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Daily AI Limit</th>
                    <th className="py-2.5 px-4 font-semibold">Status</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {invitations.map((inv) => (
                    <tr key={inv.inviteId}>
                      <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                        {inv.email}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-rose-600 dark:text-rose-400">
                        {inv.inviteCode}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {inv.maxDailyAiRequests}/day
                      </td>
                      <td className="py-2.5 px-4 capitalize text-slate-600 dark:text-slate-400">
                        {inv.status}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {inv.status !== 'revoked' ? (
                          <button
                            type="button"
                            onClick={() => handleToggleInviteStatus(inv, 'revoked')}
                            className="text-red-600 dark:text-red-400 hover:underline"
                          >
                            Revoke
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleInviteStatus(inv, 'pending')}
                            className="text-emerald-600 dark:text-emerald-400 hover:underline"
                          >
                            Restore
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Registered Users & Quota Management */}
      {(activeTab === 'admin-dashboard' || activeTab === 'admin-users') && (
        <div className="mb-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Registered Beta Creators & Quota Limits ({users.length})
            </h3>
            <span className="text-xs text-slate-500">
              Private workspace contents are isolated per user
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4 font-semibold">Creator</th>
                  <th className="py-3 px-4 font-semibold">Email</th>
                  <th className="py-3 px-4 font-semibold">Role</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Daily AI Limit</th>
                  <th className="py-3 px-4 font-semibold text-right">Governance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {users.map((u) => (
                  <tr key={u.uid}>
                    <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100">
                      {u.displayName}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400">{u.email}</td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                      {u.role.replace('_', ' ')}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={
                          u.status === 'active'
                            ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                            : 'text-red-600 dark:text-red-400 font-medium'
                        }
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {u.dailyAiLimit}/day
                    </td>
                    <td className="py-3 px-4 text-right space-x-3">
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateUserAccount(u, u.status, u.dailyAiLimit + 25)
                        }
                        className="text-rose-600 dark:text-rose-400 hover:underline"
                      >
                        +25 Daily Quota
                      </button>
                      {u.uid !== adminUid && (
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateUserAccount(
                              u,
                              u.status === 'active' ? 'suspended' : 'active',
                              u.dailyAiLimit
                            )
                          }
                          className="text-slate-600 dark:text-slate-400 hover:underline"
                        >
                          {u.status === 'active' ? 'Suspend' : 'Activate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AI Usage Telemetry & Audit Logs */}
      {(activeTab === 'admin-dashboard' || activeTab === 'admin-usage') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Recent AI Token & Cost Ledger
              </h3>
            </div>
            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                    <th className="py-2.5 px-4 font-semibold">Operation</th>
                    <th className="py-2.5 px-4 font-semibold">Model</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Tokens</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Est. Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {usageRecords.slice(0, 15).map((r) => (
                    <tr key={r.recordId}>
                      <td className="py-2.5 px-4 text-slate-900 dark:text-slate-100">
                        {r.operation.replace(/_/g, ' ')}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-500">{r.model}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {(r.inputTokens + r.outputTokens).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        ${r.estimatedCostUsd.toFixed(5)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Immutable Security & System Audit Logs
              </h3>
            </div>
            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                    <th className="py-2.5 px-4 font-semibold">Time</th>
                    <th className="py-2.5 px-4 font-semibold">Actor</th>
                    <th className="py-2.5 px-4 font-semibold">Action</th>
                    <th className="py-2.5 px-4 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {auditLogs.slice(0, 15).map((log) => (
                    <tr key={log.logId}>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300 truncate max-w-[120px]">
                        {log.actorEmail}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                        {log.action.replace(/_/g, ' ')}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400 truncate max-w-xs">
                        {log.details}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
