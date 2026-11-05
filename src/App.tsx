import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { onSnapshot } from 'firebase/firestore';
import {
  LayoutDashboard,
  Youtube,
  ClipboardCheck,
  Sparkles,
  Compass,
  Users,
  TrendingUp,
  Target,
  Lightbulb,
  FileText,
  Activity,
  Film,
  Image as ImageIcon,
  Search,
  Calendar,
  BarChart3,
  FileBarChart,
  MessageSquare,
  Plug,
  Settings as SettingsIcon,
  Shield,
  Sun,
  Moon,
  LogOut,
  RefreshCw,
  Download,
  Trash2,
  ArrowRight,
  Menu,
  X,
} from 'lucide-react';
import {
  auth,
  db,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  OperationType,
  handleFirestoreError,
  signInWithGoogleIdentity,
  connectYouTubeWithOAuth,
  clearYouTubeToken,
  signOutUser,
  clampStr,
  recordAiUsage,
  recordAuditLog,
} from './lib/firebase';
import {
  NavSectionId,
  UserProfile,
  Workspace,
  YouTubeConnection,
  ChannelProfile,
  ChannelVideo,
  ResearchReport,
  ContentIdea,
  ScriptDocument,
  AnalyticsSnapshot,
  ContentProject,
  UsageRecord,
} from './types';
import { ModuleBanner, ConfirmModal } from './components/ModuleBanner';
import { OnboardingWizard } from './components/OnboardingWizard';
import { ResearchModules } from './components/ResearchModules';
import { ProductionStudio } from './components/ProductionStudio';
import { GrowthAndAnalytics } from './components/GrowthAndAnalytics';
import { AdminConsole } from './components/AdminConsole';

const BOOTSTRAPPED_ADMIN_EMAIL = 'anishakumari136x@gmail.com';

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // Workspace Data State
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [connection, setConnection] = useState<YouTubeConnection | null>(null);
  const [channelProfile, setChannelProfile] = useState<ChannelProfile | null>(null);
  const [videos, setVideos] = useState<ChannelVideo[]>([]);
  const [reports, setReports] = useState<ResearchReport[]>([]);
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [scripts, setScripts] = useState<ScriptDocument[]>([]);
  const [snapshots, setSnapshots] = useState<AnalyticsSnapshot[]>([]);
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);

  // Navigation & UI State
  const [activeNav, setActiveNav] = useState<NavSectionId>('overview');
  const [prefillTopic, setPrefillTopic] = useState<string>('');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState('ASH-BETA-2026');
  const [authError, setAuthError] = useState<string | null>(null);
  const [auditRefreshing, setAuditRefreshing] = useState(false);

  // Destructive Action Confirmation Modals
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const [confirmDeleteWorkspaceOpen, setConfirmDeleteWorkspaceOpen] = useState(false);

  // Sync theme class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Initialize Auth & Ensure UserProfile in Firestore
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (!user) {
        setUserProfile(null);
        setWorkspace(null);
        setChannelProfile(null);
        setAuthReady(true);
        return;
      }

      try {
        const userRef = doc(db, 'users', user.uid);
        const snap = await getDoc(userRef);
        const now = new Date().toISOString();
        const isSuperAdmin = user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;

        if (snap.exists()) {
          setUserProfile(snap.data() as UserProfile);
        } else {
          const newProfile: UserProfile = {
            uid: user.uid,
            displayName: clampStr(user.displayName || user.email?.split('@')[0] || 'Creator', 120, 'Creator'),
            email: clampStr(user.email || 'creator@ash.studio', 254, 'creator@ash.studio'),
            role: isSuperAdmin ? 'super_admin' : 'creator',
            status: 'active',
            inviteCodeUsed: clampStr(inviteCodeInput || 'ASH-BETA-2026', 64, 'ASH-BETA-2026'),
            dailyAiLimit: isSuperAdmin ? 500 : 50,
            monthlyAiLimit: isSuperAdmin ? 15000 : 1500,
            preferences: JSON.stringify({ defaultLanguage: 'English', theme: 'dark' }),
            createdAt: now,
            updatedAt: now,
          };
          await setDoc(userRef, newProfile);
          setUserProfile(newProfile);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsub();
  }, []);

  // Attach Real-Time Workspace Listeners once authenticated
  useEffect(() => {
    if (!authReady || !currentUser) return;
    const uid = currentUser.uid;

    const unsubs: Array<() => void> = [];

    // 1. Workspaces
    unsubs.push(
      onSnapshot(
        query(collection(db, 'workspaces'), where('ownerUid', '==', uid)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as Workspace);
          setWorkspace(list[0] || null);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'workspaces')
      )
    );

    // 2. YouTube Connections
    unsubs.push(
      onSnapshot(
        query(collection(db, 'youtubeConnections'), where('ownerUid', '==', uid)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as YouTubeConnection);
          setConnection(list[0] || null);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'youtubeConnections')
      )
    );

    // 3. Channel Profiles
    unsubs.push(
      onSnapshot(
        query(collection(db, 'channelProfiles'), where('ownerUid', '==', uid)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as ChannelProfile);
          setChannelProfile(list[0] || null);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'channelProfiles')
      )
    );

    // 4. Videos
    unsubs.push(
      onSnapshot(
        query(collection(db, 'videos'), where('ownerUid', '==', uid)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as ChannelVideo);
          setVideos(list.sort((a, b) => b.views - a.views));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'videos')
      )
    );

    // 5. Research Reports
    unsubs.push(
      onSnapshot(
        query(collection(db, 'researchReports'), where('ownerUid', '==', uid)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as ResearchReport);
          setReports(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'researchReports')
      )
    );

    // 6. Content Ideas
    unsubs.push(
      onSnapshot(
        query(collection(db, 'contentIdeas'), where('ownerUid', '==', uid)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as ContentIdea);
          setIdeas(list.sort((a, b) => b.opportunityScore - a.opportunityScore));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'contentIdeas')
      )
    );

    // 7. Scripts
    unsubs.push(
      onSnapshot(
        query(collection(db, 'scripts'), where('ownerUid', '==', uid)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as ScriptDocument);
          setScripts(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'scripts')
      )
    );

    // 8. Analytics Snapshots
    unsubs.push(
      onSnapshot(
        query(collection(db, 'analyticsSnapshots'), where('ownerUid', '==', uid)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as AnalyticsSnapshot);
          setSnapshots(list.sort((a, b) => b.syncedAt.localeCompare(a.syncedAt)));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'analyticsSnapshots')
      )
    );

    // 9. Projects / Calendar
    unsubs.push(
      onSnapshot(
        query(collection(db, 'projects'), where('ownerUid', '==', uid)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as ContentProject);
          setProjects(list.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'projects')
      )
    );

    // 10. Usage Records for Current User
    unsubs.push(
      onSnapshot(
        query(collection(db, 'usageRecords'), where('uid', '==', uid)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as UsageRecord);
          setUsageRecords(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'usageRecords')
      )
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [authReady, currentUser]);

  const handleNavigate = (tab: NavSectionId, topic?: string) => {
    if (topic) setPrefillTopic(topic);
    setActiveNav(tab);
    setShowOnboarding(false);
    setMobileMenuOpen(false);
  };

  const handleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithGoogleIdentity();
    } catch (err: any) {
      setAuthError(err.message || 'Google sign-in failed.');
    }
  };

  const handleRefreshAudit = async () => {
    if (!channelProfile || !currentUser || !workspace) return;
    setAuditRefreshing(true);
    try {
      const res = await fetch('/api/v1/channel/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelData: {
            channelName: channelProfile.channelName,
            channelHandle: channelProfile.channelHandle,
            subscriberCount: channelProfile.subscriberCount,
            totalViews: channelProfile.totalViews,
            videoCount: channelProfile.videoCount,
            recentVideos: videos.slice(0, 6),
          },
          creatorGoals: channelProfile.positioning,
          isNewCreator: workspace.mode === 'new_creator',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Channel audit refresh failed.');

      if (data.usage) {
        await recordAiUsage(currentUser.uid, workspace.workspaceId, data.usage);
      }

      const p = data.profile;
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'channelProfiles', workspace.workspaceId), {
        niche: clampStr(p.niche, 200, channelProfile.niche),
        subNiches: clampStr(JSON.stringify(p.subNiches || []), 1000, '[]'),
        audienceProfile: clampStr(p.audienceProfile, 3000, channelProfile.audienceProfile),
        positioning: clampStr(p.positioning, 2000, channelProfile.positioning),
        strengths: clampStr(JSON.stringify(p.strengths || []), 3000, '[]'),
        weaknesses: clampStr(JSON.stringify(p.weaknesses || []), 3000, '[]'),
        opportunities: clampStr(JSON.stringify(p.opportunities || []), 3000, '[]'),
        recommendations: clampStr(JSON.stringify(p.recommendations || []), 3000, '[]'),
        lastAnalyzedAt: now,
        updatedAt: now,
      });
    } catch (err: any) {
      console.error(err);
    } finally {
      setAuditRefreshing(false);
    }
  };

  const handleConfirmDisconnectChannel = async () => {
    if (!connection || !currentUser) return;
    clearYouTubeToken();
    const path = `youtubeConnections/${connection.connectionId}`;
    try {
      await updateDoc(doc(db, 'youtubeConnections', connection.connectionId), {
        connectionStatus: 'revoked',
        grantedScopes: 'revoked',
        updatedAt: new Date().toISOString(),
      });
      await recordAuditLog(
        currentUser.uid,
        currentUser.email || '',
        'youtube_connection_revoked',
        path,
        `Disconnected channel ${connection.channelTitle}`
      );
      setConfirmDisconnectOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleConfirmDeleteWorkspace = async () => {
    if (!workspace || !currentUser) return;
    try {
      for (const v of videos) {
        await deleteDoc(doc(db, 'videos', v.videoDocId));
      }
      for (const r of reports) {
        await deleteDoc(doc(db, 'researchReports', r.reportId));
      }
      for (const i of ideas) {
        await deleteDoc(doc(db, 'contentIdeas', i.ideaId));
      }
      for (const s of scripts) {
        await deleteDoc(doc(db, 'scripts', s.scriptId));
      }
      for (const p of projects) {
        await deleteDoc(doc(db, 'projects', p.projectId));
      }
      if (channelProfile) {
        await deleteDoc(doc(db, 'channelProfiles', workspace.workspaceId));
      }
      if (connection) {
        await deleteDoc(doc(db, 'youtubeConnections', connection.connectionId));
      }
      await deleteDoc(doc(db, 'workspaces', workspace.workspaceId));
      setConfirmDeleteWorkspaceOpen(false);
      setShowOnboarding(true);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `workspaces/${workspace.workspaceId}`);
    }
  };

  const handleExportWorkspaceJson = () => {
    const bundle = {
      exportedAt: new Date().toISOString(),
      workspace,
      channelProfile,
      videos,
      researchReports: reports,
      contentIdeas: ideas,
      scripts,
      analyticsSnapshots: snapshots,
      projects,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ash_creator_studio_export_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // -------------------------------------------------------------------------
  // UNAUTHENTICATED LANDING & PRIVATE BETA SIGN-IN VIEW
  // -------------------------------------------------------------------------
  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 text-sm">
        Initializing ASH Creator Studio...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        {/* Strict 3-Zone Top Bar Contract */}
        <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
          >
            ASH Creator Studio
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
            <a href="#intelligence" className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0">
              Channel Intelligence
            </a>
            <a href="#research" className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0">
              Research Radar
            </a>
            <a href="#production" className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0">
              Script Studio
            </a>
            <a href="#analytics" className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0">
              Analytics Lab
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleSignIn}
              className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Sign in with Google
            </button>
          </div>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-14">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
            <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Private 50-Creator Beta · Multi-Tenant YouTube Intelligence Platform
              </div>
              <h1
                className="text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight"
                style={{ textWrap: 'balance' }}
              >
                Your AI Partner for Evidence-Backed YouTube Growth
              </h1>
              <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
                Connect your YouTube channel or start from zero in New Creator Mode. ASH Creator Studio studies your niche, verifies factual claims with Google Search grounding, ranks content opportunities with transparent scoring, and builds complete multi-language scripts and storyboards.
              </p>

              <div className="pt-2 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-200 dark:border-slate-800 text-xs">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    16 Specialized AI Agents
                  </div>
                  <p className="text-slate-500 mt-0.5">
                    Orchestrated across Channel Audit, Trend Radar, Fact Checker & Script Studio.
                  </p>
                </div>
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    English, Hindi & Hinglish
                  </div>
                  <p className="text-slate-500 mt-0.5">
                    Native script generation, Hook Optimizer, and Gemini Audio TTS voiceovers.
                  </p>
                </div>
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    Zero False Guarantees
                  </div>
                  <p className="text-slate-500 mt-0.5">
                    Separates verified data from estimates and isolates every creator workspace.
                  </p>
                </div>
              </div>
            </div>

            {/* Beta Invitation & Google Sign-In Card */}
            <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                  Step 1 · Private Beta Access Verification
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  Enter Your Creator Workspace
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  During our initial 50-user private beta, each account receives an isolated Cloud Firestore workspace with configurable daily AI usage governance.
                </p>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Beta Invitation Code
                  </label>
                  <input
                    type="text"
                    value={inviteCodeInput}
                    onChange={(e) => setInviteCodeInput(e.target.value)}
                    placeholder="ASH-BETA-2026"
                    className="w-full px-3.5 py-2 text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>

                {authError && (
                  <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                    {authError}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleSignIn}
                  className="w-full flex items-center justify-center gap-3 px-5 py-3 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-xl transition-colors whitespace-nowrap shrink-0"
                >
                  <svg className="w-4 h-4 bg-white rounded-full p-0.5" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  </svg>
                  <span>Continue with Google</span>
                </button>
                <div className="text-[11px] text-center text-slate-500">
                  Supports Public Channel URL Analysis, OAuth 2.0 YouTube Analytics, and New Creator Mode.
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // If authenticated but no workspace/channelProfile exists yet (or user clicked Re-run Onboarding)
  if (!workspace || !channelProfile || showOnboarding) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <span className="text-lg font-bold tracking-tight whitespace-nowrap shrink-0">
            ASH Creator Studio
          </span>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-500">
            <span className="whitespace-nowrap shrink-0">Creator Onboarding</span>
          </nav>
          <div className="flex items-center gap-3 shrink-0">
            {workspace && channelProfile && (
              <button
                type="button"
                onClick={() => setShowOnboarding(false)}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
              >
                Return to Dashboard
              </button>
            )}
            <button
              type="button"
              onClick={signOutUser}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              Sign Out
            </button>
          </div>
        </header>

        <OnboardingWizard
          uid={currentUser.uid}
          userEmail={currentUser.email || ''}
          userDisplayName={currentUser.displayName || 'Creator'}
          existingWorkspace={workspace}
          onComplete={() => {
            setShowOnboarding(false);
            setActiveNav('overview');
          }}
        />
      </div>
    );
  }

  // Parse channel profile JSON arrays
  let parsedSubNiches: string[] = [];
  let parsedStrengths: string[] = [];
  let parsedWeaknesses: string[] = [];
  let parsedOpportunities: string[] = [];
  let parsedRecommendations: string[] = [];

  try { parsedSubNiches = JSON.parse(channelProfile.subNiches || '[]'); } catch { parsedSubNiches = []; }
  try { parsedStrengths = JSON.parse(channelProfile.strengths || '[]'); } catch { parsedStrengths = []; }
  try { parsedWeaknesses = JSON.parse(channelProfile.weaknesses || '[]'); } catch { parsedWeaknesses = []; }
  try { parsedOpportunities = JSON.parse(channelProfile.opportunities || '[]'); } catch { parsedOpportunities = []; }
  try { parsedRecommendations = JSON.parse(channelProfile.recommendations || '[]'); } catch { parsedRecommendations = []; }

  const isSuperAdmin =
    userProfile?.role === 'super_admin' ||
    currentUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;

  const SIDEBAR_GROUPS: Array<{
    groupTitle: string;
    items: Array<{ id: NavSectionId; label: string; icon: React.ComponentType<{ className?: string }> }>;
  }> = [
    {
      groupTitle: 'Channel Intelligence',
      items: [
        { id: 'overview', label: '1. Overview', icon: LayoutDashboard },
        { id: 'my-channel', label: '2. My Channel', icon: Youtube },
        { id: 'channel-audit', label: '3. Channel Audit', icon: ClipboardCheck },
        { id: 'growth-coach', label: '4. AI Growth Coach', icon: Sparkles },
      ],
    },
    {
      groupTitle: 'Research Radar',
      items: [
        { id: 'niche-research', label: '5. Niche Research', icon: Compass },
        { id: 'audience-research', label: '6. Audience Research', icon: Users },
        { id: 'trend-radar', label: '7. Trend Radar', icon: TrendingUp },
        { id: 'competitor-research', label: '8. Competitor Research', icon: Target },
      ],
    },
    {
      groupTitle: 'Content Production',
      items: [
      {
        id: 'content-ideas',
        label: '9. Content Ideas',
        icon: Lightbulb,
      },
      {
        id: 'script-studio',
        label: '10. Video Script Studio',
        icon: FileText,
      },
      {
        id: 'retention-coach',
        label: '11. Retention Coach',
        icon: Activity,
      },
      {
        id: 'visual-studio',
        label: '12. Visual Studio',
        icon: Film,
      },
      {
        id: 'thumbnail-studio',
        label: '13. Thumbnail Studio',
        icon: ImageIcon,
      },
      {
        id: 'seo-studio',
        label: '14. SEO Studio',
        icon: Search,
      },
      {
        id: 'content-calendar',
        label: '15. Content Calendar',
        icon: Calendar,
      },
    ],
  },
  {
    groupTitle: 'Analytics & Workspace',
    items: [
      { id: 'analytics-lab', label: '16. Analytics Lab', icon: BarChart3 },
      { id: 'growth-reports', label: '17. Growth Reports', icon: FileBarChart },
      { id: 'ai-chat', label: '18. AI Chat Assistant', icon: MessageSquare },
      { id: 'integrations', label: '19. Integrations', icon: Plug },
      { id: 'settings', label: '20. Settings', icon: SettingsIcon },
    ],
  },
];

  if (isSuperAdmin) {
    SIDEBAR_GROUPS.push({
      groupTitle: 'Super Admin Governance',
      items: [
        { id: 'admin-dashboard', label: 'Admin Dashboard', icon: Shield },
        { id: 'admin-users', label: 'User Management', icon: Users },
        { id: 'admin-invitations', label: 'Beta Invitations', icon: Sparkles },
        { id: 'admin-usage', label: 'AI Cost & Logs', icon: Activity },
      ],
    });
  }

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <ConfirmModal
        open={confirmDisconnectOpen}
        title="Disconnect YouTube Channel?"
        description="This immediately clears any active OAuth session tokens and marks your YouTube channel connection as revoked. Your saved scripts and ideas will remain in your workspace."
        confirmLabel="Disconnect Channel"
        onConfirm={handleConfirmDisconnectChannel}
        onCancel={() => setConfirmDisconnectOpen(false)}
      />

      <ConfirmModal
        open={confirmDeleteWorkspaceOpen}
        title="Permanently Delete Creator Workspace?"
        description="This will permanently delete your workspace profile, tracked videos, research reports, content ideas, scripts, and calendar events from Cloud Firestore. This action cannot be undone."
        confirmLabel="Delete Entire Workspace"
        onConfirm={handleConfirmDeleteWorkspace}
        onCancel={() => setConfirmDeleteWorkspaceOpen(false)}
      />

      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => handleNavigate('overview')}
          className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
        >
          ASH Creator Studio
        </button>

        {/* Zone 2: 5 concise single-line text links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
          <button
            type="button"
            onClick={() => handleNavigate('overview')}
            className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => handleNavigate('trend-radar')}
            className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Research
          </button>
          <button
            type="button"
            onClick={() => handleNavigate('content-ideas')}
            className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Opportunities
          </button>
          <button
            type="button"
            onClick={() => handleNavigate('script-studio')}
            className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Video Script Studio
          </button>
          <button
            type="button"
            onClick={() => handleNavigate('analytics-lab')}
            className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Analytics Lab
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => handleNavigate('script-studio')}
            className="px-3.5 sm:px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            New Video Script
          </button>
        </div>
      </header>

      {/* Mobile Quick Navigation Bar (< md) */}
      <div className="flex md:hidden items-center gap-2 overflow-x-auto px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900/80 text-xs">
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-white bg-slate-900 dark:bg-slate-800 rounded-md whitespace-nowrap shrink-0"
        >
          <Menu className="w-3.5 h-3.5" />
          <span>All 20 Modules</span>
        </button>
        <button
          type="button"
          onClick={() => handleNavigate('overview')}
          className={`px-2.5 py-1.5 rounded-md font-medium whitespace-nowrap shrink-0 ${
            activeNav === 'overview'
              ? 'bg-rose-600 text-white'
              : 'text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-950'
          }`}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => handleNavigate('trend-radar')}
          className={`px-2.5 py-1.5 rounded-md font-medium whitespace-nowrap shrink-0 ${
            activeNav === 'trend-radar'
              ? 'bg-rose-600 text-white'
              : 'text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-950'
          }`}
        >
          Research
        </button>
        <button
          type="button"
          onClick={() => handleNavigate('content-ideas')}
          className={`px-2.5 py-1.5 rounded-md font-medium whitespace-nowrap shrink-0 ${
            activeNav === 'content-ideas'
              ? 'bg-rose-600 text-white'
              : 'text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-950'
          }`}
        >
          Content Ideas
        </button>
        <button
          type="button"
          onClick={() => handleNavigate('script-studio')}
          className={`px-2.5 py-1.5 rounded-md font-medium whitespace-nowrap shrink-0 ${
            activeNav === 'script-studio'
              ? 'bg-rose-600 text-white'
              : 'text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-950'
          }`}
        >
          Video Script
        </button>
        <button
          type="button"
          onClick={() => handleNavigate('analytics-lab')}
          className={`px-2.5 py-1.5 rounded-md font-medium whitespace-nowrap shrink-0 ${
            activeNav === 'analytics-lab'
              ? 'bg-rose-600 text-white'
              : 'text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-950'
          }`}
        >
          Analytics
        </button>
      </div>

      {/* Main Workspace Container (Sidebar + Main Viewport) */}
      <div className="flex-1 flex relative">
        {/* Mobile Drawer Backdrop */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-xs lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Left Sidebar Navigation (260px) */}
        <aside
          className={`${
            mobileMenuOpen ? 'fixed inset-y-0 left-0 z-40 block shadow-2xl' : 'hidden lg:block'
          } w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-y-auto`}
        >
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="truncate">
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                {channelProfile.channelName}
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                {channelProfile.channelHandle} · {workspace.mode === 'new_creator' ? 'New Creator' : 'Connected'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 space-y-5">
            {SIDEBAR_GROUPS.map((group) => (
              <div key={group.groupTitle}>
                <div className="px-2.5 mb-1.5 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                  {group.groupTitle}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeNav === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleNavigate(item.id)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                          isActive
                            ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-semibold'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 min-w-0 px-4 sm:px-6 py-4 sm:py-6 max-w-6xl mx-auto w-full">
          {/* Workspace Contextual Sub-Toolbar */}
          <div className="mb-6 pb-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-slate-500">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="hidden md:inline-flex lg:hidden items-center gap-1 px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md text-slate-700 dark:text-slate-300"
              >
                <Menu className="w-3.5 h-3.5" />
                <span>Modules</span>
              </button>
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Workspace: {workspace.workspaceName}
              </span>
              <span aria-hidden="true">·</span>
              <span>Niche: {channelProfile.niche}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                AI Calls: {usageRecords.length} / {userProfile?.dailyAiLimit || 50} daily
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setShowOnboarding(true)}
                className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 underline whitespace-nowrap shrink-0"
              >
                Switch / Reconnect Channel
              </button>
              <button
                type="button"
                onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                <span>{theme === 'dark' ? 'Light Theme' : 'Dark Theme'}</span>
              </button>
              <button
                type="button"
                onClick={signOutUser}
                className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400 hover:text-red-600 whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>

          {/* 1. OVERVIEW DASHBOARD */}
          {activeNav === 'overview' && (
            <div>
              <ModuleBanner
                title={`${channelProfile.channelName} — Creator Growth Command`}
                whatItDoes="Synthesizes your channel profile, ranked content opportunities, active video script packages, and publishing schedule in one clean command view."
                whyItMatters="Helps you move systematically from Research -> Opportunity Scoring -> Video Script & Visual Plan -> Published Performance Feedback."
                howToUse="Review the 5-step Quick Start Guide below, or jump directly to Content Ideas or Video Script Studio."
                nextActionLabel="Generate Ranked Content Ideas"
                onNextAction={() => handleNavigate('content-ideas')}
              />

              {/* 4-Column KPI Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                  <div className="text-xs text-slate-500">Channel Subscribers</div>
                  <div className="mt-1 text-xl sm:text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {workspace.mode === 'new_creator' && channelProfile.subscriberCount === 0
                      ? 'New Creator Mode'
                      : channelProfile.subscriberCount.toLocaleString()}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 truncate">
                    {channelProfile.channelHandle} · {channelProfile.language}
                  </div>
                </div>

                <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                  <div className="text-xs text-slate-500">Ranked Content Ideas</div>
                  <div className="mt-1 text-xl sm:text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {ideas.length}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Top Score: {ideas[0]?.opportunityScore || 0}/100
                  </div>
                </div>

                <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                  <div className="text-xs text-slate-500">Video Scripts Completed</div>
                  <div className="mt-1 text-xl sm:text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {scripts.length}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    With Hooks, Storyboards & SEO
                  </div>
                </div>

                <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                  <div className="text-xs text-slate-500">Research Reports & Audits</div>
                  <div className="mt-1 text-xl sm:text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {reports.length + 1}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Confidence: {channelProfile.confidence.replace(/_/g, ' ')}
                  </div>
                </div>
              </div>

              {/* Step-by-Step How To Use ASH Creator Studio Guide */}
              <div className="mb-6 p-4 sm:p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                      Quick Start Workflow · How to Use ASH Creator Studio
                    </div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      5 Simple Steps from Research to Published YouTube Video
                    </h2>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs text-slate-600 dark:text-slate-400 pt-1">
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                    <div className="font-bold text-slate-900 dark:text-slate-100">
                      1. Channel Audit
                    </div>
                    <p className="mt-1">
                      Check <strong>My Channel / Audit</strong> to review your niche positioning, strengths, and content gaps.
                    </p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                    <div className="font-bold text-slate-900 dark:text-slate-100">
                      2. Research Radar
                    </div>
                    <p className="mt-1">
                      Open <strong>Trend Radar</strong> or <strong>Competitor Research</strong> to discover rising topics and whitespace gaps.
                    </p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                    <div className="font-bold text-slate-900 dark:text-slate-100">
                      3. Content Ideas
                    </div>
                    <p className="mt-1">
                      Go to <strong>9. Content Ideas</strong>, generate scored video ideas (0–100), and click <strong>Write Script</strong>.
                    </p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                    <div className="font-bold text-slate-900 dark:text-slate-100">
                      4. Video Script Studio
                    </div>
                    <p className="mt-1">
                      In <strong>10. Video Script Studio</strong>, generate your full <strong>VIDEO</strong> script, hooks, Visual Storyboard, Thumbnail & SEO.
                    </p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                    <div className="font-bold text-slate-900 dark:text-slate-100">
                      5. Calendar & Analytics
                    </div>
                    <p className="mt-1">
                      Schedule in <strong>Content Calendar</strong> and track CTR, views, and watch time in <strong>Analytics Lab</strong>.
                    </p>
                  </div>
                </div>
              </div>

              {/* New Creator Mode Starter Guide if applicable */}
              {workspace.mode === 'new_creator' && (
                <div className="mb-8 p-4 sm:p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
                  <div className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                    New Creator Mode Active · Zero Fabricated Analytics
                  </div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Your 4-Step First-Upload Blueprint
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs text-slate-600 dark:text-slate-400 pt-1">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        01. Validate Demand
                      </div>
                      <p className="mt-0.5">
                        Use Trend Radar & Audience Research to find beginner questions in {channelProfile.niche}.
                      </p>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        02. Score 4 Opportunities
                      </div>
                      <p className="mt-0.5">
                        Pick an idea with High Production Feasibility so you finish your first upload without burnout.
                      </p>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        03. Video Script + Visual Plan
                      </div>
                      <p className="mt-0.5">
                        Generate your video script, non-clickbait hook, and scene-by-scene Visual Director storyboard.
                      </p>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        04. Log Real Results
                      </div>
                      <p className="mt-0.5">
                        Record your published video’s performance in Analytics Lab to train your AI Growth Coach.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 2-Column Split: Recommended Next Actions & Recent Opportunities */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      AI Channel Audit — Priority Next Actions
                    </h2>
                    <button
                      type="button"
                      onClick={() => handleNavigate('channel-audit')}
                      className="text-xs text-rose-600 dark:text-rose-400 hover:underline"
                    >
                      Full Channel Audit
                    </button>
                  </div>
                  <ul className="space-y-2.5 text-xs text-slate-700 dark:text-slate-300">
                    {parsedRecommendations.map((rec, i) => (
                      <li
                        key={i}
                        className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex items-start justify-between gap-3"
                      >
                        <span>
                          <strong className="text-slate-900 dark:text-slate-100">0{i + 1}.</strong> {rec}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleNavigate('content-ideas', rec)}
                          className="text-rose-600 dark:text-rose-400 shrink-0 hover:underline"
                        >
                          Act
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Top Ranked Content Opportunities
                    </h2>
                    <button
                      type="button"
                      onClick={() => handleNavigate('content-ideas')}
                      className="text-xs text-rose-600 dark:text-rose-400 hover:underline"
                    >
                      Open Opportunity Engine
                    </button>
                  </div>

                  {ideas.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                      No content ideas generated yet. Click Generate Ranked Content Ideas above to discover high-fit topics.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {ideas.slice(0, 4).map((idea) => (
                        <div
                          key={idea.ideaId}
                          className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="truncate">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {idea.title}
                            </div>
                            <div className="text-slate-500">
                              {idea.format.replace('_', '-')} · Competition: {idea.competitionLevel}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-mono font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                              {idea.opportunityScore}/100
                            </span>
                            <button
                              type="button"
                              onClick={() => handleNavigate('script-studio', idea.title)}
                              className="text-slate-700 dark:text-slate-300 hover:underline"
                            >
                              Script
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 2. MY CHANNEL & 3. CHANNEL AUDIT */}
          {(activeNav === 'my-channel' || activeNav === 'channel-audit') && (
            <div>
              <ModuleBanner
                title={
                  activeNav === 'my-channel'
                    ? 'My Channel Profile & Positioning'
                    : 'Comprehensive AI Channel Audit'
                }
                whatItDoes="Evaluates your recurring upload themes, format balance, audience expectations, strengths, weaknesses, and untapped content opportunities."
                whyItMatters="Keeps your channel positioning sharp and ensures every AI agent adapts to your specific audience and format."
                howToUse="Click Refresh Channel Audit to re-analyze your channel profile and recent videos, or click any opportunity to generate video ideas."
                nextActionLabel="Research Niche Clusters"
                onNextAction={() => handleNavigate('niche-research', channelProfile.niche)}
              />

              <div className="mb-6 p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="text-xs text-slate-500">
                      Channel ID: {channelProfile.channelId} · Confidence: {channelProfile.confidence} · Last Analyzed:{' '}
                      {new Date(channelProfile.lastAnalyzedAt).toLocaleDateString()}
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {channelProfile.channelName} ({channelProfile.channelHandle})
                    </h2>
                  </div>

                  <button
                    type="button"
                    onClick={handleRefreshAudit}
                    disabled={auditRefreshing}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${auditRefreshing ? 'animate-spin' : ''}`} />
                    <span>{auditRefreshing ? 'Re-Analyzing Channel...' : 'Refresh Channel Audit'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                    <div className="text-slate-500">Primary Niche & Format</div>
                    <div className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                      {channelProfile.niche}
                    </div>
                    <div className="mt-1 text-slate-500">
                      Format: {channelProfile.format} · Language: {channelProfile.language}
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                    <div className="text-slate-500">Sub-Niches</div>
                    <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                      {parsedSubNiches.join(' · ') || 'General'}
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                    <div className="text-slate-500">Channel Positioning</div>
                    <div className="mt-1 text-slate-800 dark:text-slate-200 leading-relaxed">
                      {channelProfile.positioning}
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
                    Estimated Audience Profile (Inferred from channel topics & public signals)
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                    {channelProfile.audienceProfile}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 text-xs">
                  <div className="p-5 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                    <h3 className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                      Channel Strengths
                    </h3>
                    <ul className="space-y-1.5 text-slate-600 dark:text-slate-400">
                      {parsedStrengths.map((s, i) => (
                        <li key={i}>• {s}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-5 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                    <h3 className="text-sm font-bold text-amber-600 dark:text-amber-400">
                      Bottlenecks & Weaknesses to Address
                    </h3>
                    <ul className="space-y-1.5 text-slate-600 dark:text-slate-400">
                      {parsedWeaknesses.map((w, i) => (
                        <li key={i}>• {w}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-5 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                    <h3 className="text-sm font-bold text-rose-600 dark:text-rose-400">
                      High-Leverage Content Opportunities
                    </h3>
                    <ul className="space-y-1.5 text-slate-600 dark:text-slate-400">
                      {parsedOpportunities.map((o, i) => (
                        <li key={i} className="flex items-start justify-between gap-2">
                          <span>• {o}</span>
                          <button
                            type="button"
                            onClick={() => handleNavigate('content-ideas', o)}
                            className="text-rose-600 dark:text-rose-400 hover:underline shrink-0"
                          >
                            Explore
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-5 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Recommended Next Improvements
                    </h3>
                    <ul className="space-y-1.5 text-slate-600 dark:text-slate-400">
                      {parsedRecommendations.map((r, i) => (
                        <li key={i}>• {r}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 5, 6, 7, 8, 11: RESEARCH MODULES & RETENTION/FACT CHECKER */}
          {(activeNav === 'niche-research' ||
            activeNav === 'audience-research' ||
            activeNav === 'trend-radar' ||
            activeNav === 'competitor-research' ||
            activeNav === 'retention-coach') && (
            <ResearchModules
              activeTab={activeNav}
              uid={currentUser.uid}
              workspaceId={workspace.workspaceId}
              channelProfile={channelProfile}
              videos={videos}
              reports={reports}
              onNavigate={handleNavigate}
            />
          )}

          {/* 9, 10, 12, 13, 14: PRODUCTION STUDIO */}
          {(activeNav === 'content-ideas' ||
            activeNav === 'script-studio' ||
            activeNav === 'visual-studio' ||
            activeNav === 'thumbnail-studio' ||
            activeNav === 'seo-studio') && (
            <ProductionStudio
              activeTab={activeNav}
              uid={currentUser.uid}
              workspaceId={workspace.workspaceId}
              channelProfile={channelProfile}
              ideas={ideas}
              scripts={scripts}
              prefillTopic={prefillTopic}
              onNavigate={handleNavigate}
            />
          )}

          {/* 4, 15, 16, 17, 18: GROWTH COACH, CALENDAR & ANALYTICS LAB */}
          {(activeNav === 'growth-coach' ||
            activeNav === 'ai-chat' ||
            activeNav === 'analytics-lab' ||
            activeNav === 'growth-reports' ||
            activeNav === 'content-calendar') && (
            <GrowthAndAnalytics
              activeTab={activeNav}
              uid={currentUser.uid}
              workspaceId={workspace.workspaceId}
              channelProfile={channelProfile}
              connection={connection}
              videos={videos}
              ideas={ideas}
              snapshots={snapshots}
              projects={projects}
              onNavigate={handleNavigate}
            />
          )}

          {/* 19. INTEGRATIONS HUB */}
          {activeNav === 'integrations' && (
            <div>
              <ModuleBanner
                title="External API & Provider Adapter Inventory"
                whatItDoes="Displays the live connection and adapter status for Google Gemini AI, YouTube Data API v3, YouTube Analytics API v2, Google OAuth 2.0, and Voice/Media services."
                whyItMatters="All external API credentials are managed strictly through server-side adapters—never exposed in browser code—and clearly label whether a service is connected or using a fallback."
                howToUse="Authorize or refresh your Google OAuth 2.0 YouTube connection below to enable private YouTube Analytics reports."
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {[
                  {
                    name: 'Google Gemini API (@google/genai)',
                    status: 'Active · Server-Side Adapter',
                    detail:
                      'Powers all 16 specialized creator agents, structured JSON outputs, and Google Search Grounding via gemini-3.8-flash.',
                  },
                  {
                    name: 'YouTube Data API v3 + Public Discovery',
                    status:
                      connection?.connectionStatus === 'connected'
                        ? 'OAuth Connected (youtube.readonly)'
                        : 'Public Channel Adapter Active',
                    detail:
                      'Retrieves channel metadata, upload playlists, and public video statistics.',
                  },
                  {
                    name: 'YouTube Analytics API v2',
                    status:
                      connection?.grantedScopes?.includes('yt-analytics.readonly')
                        ? 'Authorized (yt-analytics.readonly)'
                        : 'Awaiting OAuth Consent',
                    detail:
                      'Queries private watch time, average view duration, average percentage viewed, and subscriber gains.',
                  },
                  {
                    name: 'Google Search Grounding Adapter',
                    status: 'Active · Real-Time Web Citations',
                    detail:
                      'Provides time-based trend verification, competitor public topic discovery, and claim-by-claim fact checking.',
                  },
                  {
                    name: 'Gemini Audio TTS Voiceover Adapter',
                    status: 'Active · gemini-3.8-flash-lite-tts',
                    detail:
                      'Synthesizes 24kHz WAV narration previews directly inside Thumbnail & Voiceover Studio.',
                  },
                  {
                    name: 'Firebase Auth & Zero-Trust Cloud Firestore',
                    status: 'Active · Isolated Multi-Tenant Rules',
                    detail:
                      'Isolates every creator workspace by ownerUid with strict schema validation.',
                  },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        {item.name}
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        {item.status}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                      {item.detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 20. SETTINGS, EXPORT & PRIVACY CONTROLS */}
          {activeNav === 'settings' && (
            <div>
              <ModuleBanner
                title="Workspace Settings, Data Export & Privacy Controls"
                whatItDoes="Allows you to export all of your research, ideas, and scripts as JSON, revoke YouTube OAuth connections, or permanently delete your workspace."
                whyItMatters="You own 100% of your creator research and scripts and can export or delete your workspace at any time."
                howToUse="Use the controls below to export your workspace bundle or manage your connected YouTube account."
              />

              <div className="space-y-6 text-xs">
                <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Export Complete Creator Workspace
                    </h3>
                    <p className="text-slate-500 mt-0.5">
                      Download all channel profiles, research reports, ranked opportunities, scripts, and calendar events as a portable JSON archive.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportWorkspaceJson}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 rounded-lg hover:opacity-90 whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export Workspace JSON</span>
                  </button>
                </div>

                <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Revoke YouTube Connection & Clear OAuth Session
                    </h3>
                    <p className="text-slate-500 mt-0.5">
                      Current status: {connection?.connectionStatus || 'public_only'} ({connection?.channelTitle}). Disconnecting immediately revokes in-memory tokens.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmDisconnectOpen(true)}
                    className="px-4 py-2.5 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-lg hover:bg-amber-100 whitespace-nowrap shrink-0"
                  >
                    Disconnect YouTube Account
                  </button>
                </div>

                <div className="p-6 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/60 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-red-600 dark:text-red-400">
                      Delete Creator Workspace & All Stored Data
                    </h3>
                    <p className="text-slate-500 mt-0.5">
                      Permanently deletes your workspace, channel profile, videos, research reports, ideas, scripts, and calendar events from Cloud Firestore.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteWorkspaceOpen(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-lg whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Workspace</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SUPER ADMIN GOVERNANCE VIEWS */}
          {(activeNav === 'admin-dashboard' ||
            activeNav === 'admin-users' ||
            activeNav === 'admin-invitations' ||
            activeNav === 'admin-usage') &&
            isSuperAdmin && (
              <AdminConsole
                activeTab={activeNav}
                adminUid={currentUser.uid}
                adminEmail={currentUser.email || BOOTSTRAPPED_ADMIN_EMAIL}
              />
            )}
        </main>
      </div>
    </div>
  );
}
