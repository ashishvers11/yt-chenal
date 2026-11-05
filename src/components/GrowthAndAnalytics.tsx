import React, { useState } from 'react';
import {
  MessageSquare,
  BarChart3,
  Calendar,
  RefreshCw,
  ArrowRight,
  Plus,
  Trash2,
  CheckCircle2,
} from 'lucide-react';
import {
  ChannelProfile,
  ChannelVideo,
  ContentIdea,
  AnalyticsSnapshot,
  ContentProject,
  YouTubeConnection,
  NavSectionId,
} from '../types';
import {
  db,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  OperationType,
  handleFirestoreError,
  makeSafeId,
  clampStr,
  getCachedYouTubeToken,
  connectYouTubeWithOAuth,
  recordAiUsage,
} from '../lib/firebase';
import { ModuleBanner, ConfirmModal } from './ModuleBanner';

interface GrowthAndAnalyticsProps {
  activeTab:
    | 'growth-coach'
    | 'ai-chat'
    | 'analytics-lab'
    | 'growth-reports'
    | 'content-calendar';
  uid: string;
  workspaceId: string;
  channelProfile: ChannelProfile | null;
  connection: YouTubeConnection | null;
  videos: ChannelVideo[];
  ideas: ContentIdea[];
  snapshots: AnalyticsSnapshot[];
  projects: ContentProject[];
  onNavigate: (tab: NavSectionId, topicPrefill?: string) => void;
}

const STARTER_COACH_QUESTIONS = [
  'What should I make today based on my channel profile?',
  'Why are my videos not getting higher retention or views?',
  'What should I improve in my opening 15-second hooks?',
  'Which previous video performed best and how do I follow it up?',
  'What type of content format should I test next week?',
];

export const GrowthAndAnalytics: React.FC<GrowthAndAnalyticsProps> = ({
  activeTab,
  uid,
  workspaceId,
  channelProfile,
  connection,
  videos,
  ideas,
  snapshots,
  projects,
  onNavigate,
}) => {
  // AI Growth Coach State
  const [coachQuestion, setCoachQuestion] = useState('');
  const [coachHistory, setCoachHistory] = useState<
    Array<{
      question: string;
      reply: {
        directAnswer: string;
        reasoningAndEvidence: string;
        uncertaintyNote: string;
        recommendedActions: Array<{ stepTitle: string; detail: string; targetModule: string }>;
        suggestedNextTopic?: string;
      };
      timestamp: string;
    }>
  >([]);

  // Analytics Lab Manual Video Entry State
  const [newVideoTitle, setNewVideoTitle] = useState('');
  const [newVideoFormat, setNewVideoFormat] = useState<'long_form' | 'shorts'>('long_form');
  const [newVideoTopic, setNewVideoTopic] = useState(channelProfile?.niche || '');
  const [newVideoViews, setNewVideoViews] = useState<number>(0);
  const [newVideoLikes, setNewVideoLikes] = useState<number>(0);
  const [newVideoAvdSec, setNewVideoAvdSec] = useState<number>(0);
  const [newVideoApv, setNewVideoApv] = useState<number>(0);

  // Content Calendar State
  const [projName, setProjName] = useState('');
  const [projTopic, setProjTopic] = useState('');
  const [projFormat, setProjFormat] = useState<'long_form' | 'shorts' | 'series'>('long_form');
  const [projDate, setProjDate] = useState(
    new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [projNotes, setProjNotes] = useState('');
  const [projectToDelete, setProjectToDelete] = useState<ContentProject | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const latestSnapshot = snapshots[0] || null;
  const hasOAuthAnalytics =
    connection?.connectionMode === 'oauth_connected' &&
    connection?.grantedScopes?.includes('yt-analytics.readonly');

  // -------------------------------------------------------------------------
  // 1. AI GROWTH COACH & AI CHAT ASSISTANT (Nav 4 & 18)
  // -------------------------------------------------------------------------
  if (activeTab === 'growth-coach' || activeTab === 'ai-chat') {
    const handleAskCoach = async (questionText: string) => {
      const q = questionText.trim();
      if (!q) return;
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await fetch('/api/v1/coach/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: q,
            channelProfile,
            recentVideos: videos,
            analyticsSnapshot: latestSnapshot,
            savedIdeas: ideas,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'AI Growth Coach request failed.');

        if (data.usage) {
          await recordAiUsage(uid, workspaceId, data.usage);
        }

        setCoachHistory((prev) => [
          {
            question: q,
            reply: data.reply,
            timestamp: new Date().toLocaleTimeString(),
          },
          ...prev,
        ]);
        setCoachQuestion('');
      } catch (err: any) {
        setErrorMsg(err.message || 'Failed to consult AI Growth Coach.');
      } finally {
        setLoading(false);
      }
    };

    const handleSaveActionAsProject = async (stepTitle: string, detail: string) => {
      const projectId = makeSafeId('proj');
      const now = new Date().toISOString();
      const projDoc: ContentProject = {
        projectId,
        workspaceId,
        ownerUid: uid,
        projectName: clampStr(stepTitle, 240, 'Coach Action Item'),
        topic: clampStr(detail, 300, stepTitle),
        format: 'long_form',
        status: 'draft',
        scheduledDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        slotType: hasOAuthAnalytics ? 'analytics_backed_slot' : 'testing_slot',
        ideaId: '',
        scriptId: '',
        notes: clampStr(`Saved from AI Growth Coach: ${detail}`, 5000, ''),
        createdAt: now,
        updatedAt: now,
      };
      try {
        await setDoc(doc(db, 'projects', projectId), projDoc);
        onNavigate('content-calendar');
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `projects/${projectId}`);
      }
    };

    return (
      <div>
        <ModuleBanner
          title={
            activeTab === 'growth-coach'
              ? 'AI Growth Coach & Personalized Action Planner'
              : 'AI Workspace Chat Assistant'
          }
          whatItDoes="Reads your confirmed channel profile, uploaded video history, and analytics snapshots to answer strategic questions with explicit reasoning and uncertainty labels."
          whyItMatters="Generic YouTube advice fails because every channel has different audience expectations, formats, and publishing history."
          howToUse="Click one of the diagnostic prompts below or ask your own question. Save any recommended action directly into your Content Calendar."
          exampleOutput="Specific next upload recommendation + reasoning grounded in your channel profile + uncertainty disclosure."
          nextActionLabel="Generate Ranked Content Ideas"
          onNextAction={() => onNavigate('content-ideas')}
        />

        {/* Quick Diagnostic Prompts */}
        <div className="mb-6 flex flex-wrap gap-2">
          {STARTER_COACH_QUESTIONS.map((q, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleAskCoach(q)}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:border-rose-500 transition-colors whitespace-nowrap shrink-0"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Question Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAskCoach(coachQuestion);
          }}
          className="mb-8 p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col sm:flex-row gap-3"
        >
          <input
            type="text"
            value={coachQuestion}
            onChange={(e) => setCoachQuestion(e.target.value)}
            placeholder="Ask anything about your channel strategy, hooks, retention, or next video..."
            className="flex-1 px-4 py-2.5 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {loading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Analyzing Workspace...</span>
              </>
            ) : (
              <>
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Ask Growth Coach</span>
              </>
            )}
          </button>
        </form>

        {errorMsg && (
          <div className="mb-6 p-4 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        {coachHistory.length === 0 ? (
          <div className="p-10 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Ready to Analyze {channelProfile?.channelName || 'Your Channel'}
            </h3>
            <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
              Select a starter question above or ask your own question to receive channel-specific reasoning and actionable next steps.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {coachHistory.map((item, idx) => (
              <div
                key={idx}
                className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-5"
              >
                <div className="pb-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Q: {item.question}
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums">{item.timestamp}</span>
                </div>

                <div className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {item.reply.directAnswer}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-200 mb-1">
                      Channel Evidence & Reasoning
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                      {item.reply.reasoningAndEvidence}
                    </p>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-200 mb-1">
                      Uncertainty & Assumptions
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                      {item.reply.uncertaintyNote}
                    </p>
                  </div>
                </div>

                {Array.isArray(item.reply.recommendedActions) &&
                  item.reply.recommendedActions.length > 0 && (
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-200 mb-2.5">
                        Recommended Next Actions
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {item.reply.recommendedActions.map((act, i) => (
                          <div
                            key={i}
                            className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col justify-between text-xs"
                          >
                            <div>
                              <div className="font-semibold text-slate-900 dark:text-slate-100">
                                0{i + 1}. {act.stepTitle}
                              </div>
                              <p className="mt-1 text-slate-600 dark:text-slate-400 leading-relaxed">
                                {act.detail}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleSaveActionAsProject(act.stepTitle, act.detail)}
                              className="mt-3 inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium hover:underline"
                            >
                              <span>Save to Workspace Plan</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // 2. ANALYTICS LAB & GROWTH REPORTS (Nav 16 & 17)
  // -------------------------------------------------------------------------
  if (activeTab === 'analytics-lab' || activeTab === 'growth-reports') {
    const handleSyncYouTubeAnalytics = async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        let token = getCachedYouTubeToken();
        if (!token) {
          const authRes = await connectYouTubeWithOAuth(true);
          token = authRes.accessToken;
        }

        const res = await fetch('/api/v1/analytics/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to sync YouTube Analytics.');

        const snap = data.snapshot;
        const snapshotId = makeSafeId('snap');
        const snapDoc: AnalyticsSnapshot = {
          snapshotId,
          workspaceId,
          ownerUid: uid,
          dateRange: clampStr(snap.dateRange, 100, 'Last 28 Days'),
          source: 'youtube_analytics_oauth',
          views: Number(snap.views || 0),
          watchTimeHours: Number(snap.watchTimeHours || 0),
          avgViewDurationSec: Number(snap.avgViewDurationSec || 0),
          avgPercentageViewed: Number(snap.avgPercentageViewed || 0),
          subscribersGained: Number(snap.subscribersGained || 0),
          likes: Number(snap.likes || 0),
          comments: Number(snap.comments || 0),
          shares: Number(snap.shares || 0),
          impressions: Number(snap.impressions || 0),
          ctr: Number(snap.ctr || 0),
          topGeographies: 'Authorized YouTube Analytics API Report',
          deviceBreakdown: 'Desktop / Mobile / TV',
          retentionNotes: 'Synced directly from YouTube Analytics API v2 (reports.query).',
          syncedAt: new Date().toISOString(),
        };

        try {
          await setDoc(doc(db, 'analyticsSnapshots', snapshotId), snapDoc);
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `analyticsSnapshots/${snapshotId}`);
        }
      } catch (err: any) {
        setErrorMsg(err.message || 'YouTube Analytics sync failed.');
      } finally {
        setLoading(false);
      }
    };

    const handleLogPublishedVideo = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newVideoTitle.trim()) return;
      const videoDocId = makeSafeId('vid');
      const now = new Date().toISOString();
      const vidDoc: ChannelVideo = {
        videoDocId,
        workspaceId,
        ownerUid: uid,
        videoId: videoDocId,
        title: clampStr(newVideoTitle, 300, 'Published Video'),
        description: '',
        publishedAt: now.split('T')[0],
        format: newVideoFormat,
        topic: clampStr(newVideoTopic || channelProfile?.niche || 'General', 200, 'General'),
        views: Math.max(0, Number(newVideoViews || 0)),
        likes: Math.max(0, Number(newVideoLikes || 0)),
        comments: 0,
        avgViewDurationSec: Math.max(0, Number(newVideoAvdSec || 0)),
        avgPercentageViewed: Math.max(0, Math.min(200, Number(newVideoApv || 0))),
        ctr: 0,
        dataSource: 'manual_entry',
        createdAt: now,
      };
      try {
        await setDoc(doc(db, 'videos', videoDocId), vidDoc);
        setNewVideoTitle('');
        setNewVideoViews(0);
        setNewVideoLikes(0);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `videos/${videoDocId}`);
      }
    };

    // Format comparison calculations from real tracked videos
    const longFormVideos = videos.filter((v) => v.format === 'long_form');
    const shortsVideos = videos.filter((v) => v.format === 'shorts');
    const avgLongViews =
      longFormVideos.length > 0
        ? Math.round(longFormVideos.reduce((acc, v) => acc + v.views, 0) / longFormVideos.length)
        : 0;
    const avgShortsViews =
      shortsVideos.length > 0
        ? Math.round(shortsVideos.reduce((acc, v) => acc + v.views, 0) / shortsVideos.length)
        : 0;

    const handleSyncPublicMetadataInLab = async () => {
      if (!channelProfile) return;
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await fetch('/api/v1/youtube/discover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelUrlOrHandle:
              channelProfile.channelHandle || channelProfile.channelId || channelProfile.channelName,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data?.channel) throw new Error(data.error || 'Could not sync public channel stats.');
        const ch = data.channel;
        const now = new Date().toISOString();
        await updateDoc(doc(db, 'channelProfiles', workspaceId), {
          channelName: clampStr(ch.channelName || channelProfile.channelName, 200, channelProfile.channelName),
          channelHandle: clampStr(ch.channelHandle || channelProfile.channelHandle, 120, channelProfile.channelHandle),
          subscriberCount: Math.max(0, Number(ch.subscriberCount ?? channelProfile.subscriberCount ?? 0)),
          totalViews: Math.max(Number(channelProfile.totalViews || 0), Number(ch.totalViews || 0)),
          videoCount: Math.max(0, Number(ch.videoCount ?? channelProfile.videoCount ?? 0)),
          updatedAt: now,
        });
      } catch (err: any) {
        setErrorMsg(err.message || 'Public channel sync failed.');
      } finally {
        setLoading(false);
      }
    };

    return (
      <div>
        <ModuleBanner
          title={
            activeTab === 'analytics-lab'
              ? 'Analytics Lab & Video Performance'
              : 'Channel Growth & Format Performance Reports'
          }
          whatItDoes="Displays live public channel subscribers, videos, and views alongside authorized YouTube Analytics API v2 reports."
          nextActionLabel="Consult AI Growth Coach on Metrics"
          onNextAction={() => onNavigate('growth-coach')}
        />

        {/* Data Source & Sync Bar */}
        <div className="mb-6 p-5 bg-white dark:bg-[#181818] border border-neutral-200 dark:border-neutral-800 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="text-xs text-neutral-500">
              Connection Mode: {connection?.connectionMode || 'public_url'} · Status:{' '}
              {latestSnapshot?.source === 'youtube_analytics_oauth'
                ? 'Authorized OAuth Report Active'
                : 'Public Channel Telemetry Active'}
            </div>
            <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100 mt-0.5">
              {channelProfile?.channelName || 'Creator Channel'} ({channelProfile?.channelHandle})
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleSyncPublicMetadataInLab}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-neutral-800 dark:text-neutral-100 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-full transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Sync Public Subscribers & Views</span>
            </button>
            <button
              type="button"
              onClick={handleSyncYouTubeAnalytics}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#ff0033] hover:bg-red-600 rounded-full transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Sync Private Analytics (OAuth)</span>
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        {/* Metrics Summary Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="p-4 bg-white dark:bg-[#181818] border border-neutral-200 dark:border-neutral-800 rounded-xl">
            <div className="text-xs text-neutral-500">Live Subscribers</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
              {Number(channelProfile?.subscriberCount || 0).toLocaleString()}
            </div>
            <div className="mt-1 text-[11px] text-neutral-500">
              Total Uploads: {Number(channelProfile?.videoCount || 0).toLocaleString()} videos
            </div>
          </div>

          <div className="p-4 bg-white dark:bg-[#181818] border border-neutral-200 dark:border-neutral-800 rounded-xl">
            <div className="text-xs text-neutral-500">
              {latestSnapshot ? `Views (${latestSnapshot.dateRange})` : 'Recent Public Views'}
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
              {Number(
                latestSnapshot ? latestSnapshot.views : channelProfile?.totalViews || 0
              ).toLocaleString()}
            </div>
            <div className="mt-1 text-[11px] text-neutral-500">
              Source: {latestSnapshot ? latestSnapshot.source : 'Public YouTube Feed'}
            </div>
          </div>

          <div className="p-4 bg-white dark:bg-[#181818] border border-neutral-200 dark:border-neutral-800 rounded-xl">
            <div className="text-xs text-neutral-500">Watch Time & Retention</div>
            <div className="mt-1 text-xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
              {latestSnapshot
                ? `${latestSnapshot.watchTimeHours.toLocaleString()}h (${latestSnapshot.avgPercentageViewed}%)`
                : 'OAuth Optional'}
            </div>
            <div className="mt-1 text-[11px] text-neutral-500">
              {latestSnapshot ? 'Verified via YouTube Analytics API' : 'Private metric — connect OAuth'}
            </div>
          </div>

          <div className="p-4 bg-white dark:bg-[#181818] border border-neutral-200 dark:border-neutral-800 rounded-xl">
            <div className="text-xs text-neutral-500">Format Avg Views</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
              Shorts: {avgShortsViews.toLocaleString()} · Long: {avgLongViews.toLocaleString()}
            </div>
            <div className="mt-1 text-[11px] text-neutral-500 tabular-nums">
              Across {videos.length} tracked uploads
            </div>
          </div>
        </div>

        {/* Video Performance Table */}
        <div className="mb-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Video Performance Comparison Table
            </h3>
            <span className="text-xs text-slate-500 tabular-nums">
              {videos.length} videos tracked
            </span>
          </div>

          {videos.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No videos in workspace yet. If you are in New Creator Mode, log your published videos below as you release them.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                    <th className="py-3 px-4 font-semibold">Video Title</th>
                    <th className="py-3 px-4 font-semibold">Format</th>
                    <th className="py-3 px-4 font-semibold">Topic</th>
                    <th className="py-3 px-4 font-semibold text-right">Views</th>
                    <th className="py-3 px-4 font-semibold text-right">Likes</th>
                    <th className="py-3 px-4 font-semibold text-right">Avg % Viewed</th>
                    <th className="py-3 px-4 font-semibold">Data Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {videos.map((v) => (
                    <tr
                      key={v.videoDocId}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100 max-w-sm truncate">
                        {v.title}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                        {v.format.replace('_', '-')}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                        {v.topic}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {v.views.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {v.likes.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {v.avgPercentageViewed > 0 ? `${v.avgPercentageViewed}%` : '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-500">
                        {v.dataSource.replace(/_/g, ' ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Manual Publishing Result Tracker (Supports New Creator Mode & Experiment Tracking) */}
        <form
          onSubmit={handleLogPublishedVideo}
          className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4"
        >
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Log Published Video Results (Supports New Creator Mode & Experiment Tracking)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
            <div className="sm:col-span-2">
              <input
                type="text"
                value={newVideoTitle}
                onChange={(e) => setNewVideoTitle(e.target.value)}
                placeholder="Published Video Title"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              />
            </div>
            <div>
              <select
                value={newVideoFormat}
                onChange={(e) => setNewVideoFormat(e.target.value as any)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              >
                <option value="long_form">Long-form</option>
                <option value="shorts">Shorts</option>
              </select>
            </div>
            <div>
              <input
                type="number"
                min={0}
                value={newVideoViews || ''}
                onChange={(e) => setNewVideoViews(Number(e.target.value))}
                placeholder="Views"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg tabular-nums"
              />
            </div>
            <div>
              <input
                type="number"
                min={0}
                max={200}
                value={newVideoApv || ''}
                onChange={(e) => setNewVideoApv(Number(e.target.value))}
                placeholder="Avg % Viewed"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg tabular-nums"
              />
            </div>
            <div>
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Log Result</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // 3. CONTENT CALENDAR & PRODUCTION PROJECTS (Module 16 / Nav 15)
  // -------------------------------------------------------------------------
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projName.trim()) return;
    const projectId = makeSafeId('proj');
    const now = new Date().toISOString();
    const docData: ContentProject = {
      projectId,
      workspaceId,
      ownerUid: uid,
      projectName: clampStr(projName, 240, 'New Video Project'),
      topic: clampStr(projTopic || projName, 300, projName),
      format: projFormat,
      status: 'draft',
      scheduledDate: clampStr(projDate, 64, now.split('T')[0]),
      slotType: hasOAuthAnalytics ? 'analytics_backed_slot' : 'testing_slot',
      ideaId: '',
      scriptId: '',
      notes: clampStr(projNotes, 5000, ''),
      createdAt: now,
      updatedAt: now,
    };

    try {
      await setDoc(doc(db, 'projects', projectId), docData);
      setProjName('');
      setProjTopic('');
      setProjNotes('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `projects/${projectId}`);
    }
  };

  const handleUpdateProjectStatus = async (
    proj: ContentProject,
    status: ContentProject['status']
  ) => {
    const path = `projects/${proj.projectId}`;
    try {
      await updateDoc(doc(db, 'projects', proj.projectId), {
        status,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const confirmDeleteProject = async () => {
    if (!projectToDelete) return;
    const path = `projects/${projectToDelete.projectId}`;
    try {
      await deleteDoc(doc(db, 'projects', projectToDelete.projectId));
      setProjectToDelete(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  return (
    <div>
      <ModuleBanner
        title="Content Calendar & Production Pipeline"
        whatItDoes="Organizes your weekly and monthly video projects across draft, researching, scripting, production, and published stages."
        whyItMatters="Consistent publishing comes from separating research, scripting, and filming into manageable milestones."
        howToUse="Schedule a new video project below or advance existing projects through each production status. Upload slots without private audience activity reports are transparently labeled as Testing Slots."
        nextActionLabel="Open Script Studio"
        onNextAction={() => onNavigate('script-studio')}
      />

      <ConfirmModal
        open={Boolean(projectToDelete)}
        title="Delete Content Project?"
        description={`Are you sure you want to permanently remove "${projectToDelete?.projectName}" from your Content Calendar? This action cannot be undone.`}
        confirmLabel="Delete Project"
        onConfirm={confirmDeleteProject}
        onCancel={() => setProjectToDelete(null)}
      />

      {/* Add Calendar Event / Project Form */}
      <form
        onSubmit={handleCreateProject}
        className="mb-8 p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Schedule New Video Project
          </span>
          <span className="text-xs text-slate-500">
            Slot Classification:{' '}
            {hasOAuthAnalytics ? 'Analytics-Backed Audience Slot' : 'Testing Upload Slot'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="md:col-span-2">
            <input
              type="text"
              value={projName}
              onChange={(e) => setProjName(e.target.value)}
              placeholder="Video Project Title"
              className="w-full px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
            />
          </div>
          <div>
            <select
              value={projFormat}
              onChange={(e) => setProjFormat(e.target.value as any)}
              className="w-full px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
            >
              <option value="long_form">Long-form</option>
              <option value="shorts">YouTube Shorts</option>
              <option value="series">Series Episode</option>
            </select>
          </div>
          <div>
            <input
              type="date"
              value={projDate}
              onChange={(e) => setProjDate(e.target.value)}
              className="w-full px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg tabular-nums"
            />
          </div>
          <div>
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg whitespace-nowrap shrink-0"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Add to Calendar</span>
            </button>
          </div>
        </div>
      </form>

      {projects.length === 0 ? (
        <div className="p-10 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Your Content Calendar Is Empty
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Schedule a video above or send a ranked opportunity from Content Ideas directly to your calendar.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4 font-semibold">Scheduled Date</th>
                  <th className="py-3 px-4 font-semibold">Project Title</th>
                  <th className="py-3 px-4 font-semibold">Format</th>
                  <th className="py-3 px-4 font-semibold">Upload Slot Type</th>
                  <th className="py-3 px-4 font-semibold">Production Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {projects.map((p) => (
                  <tr
                    key={p.projectId}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                  >
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {p.scheduledDate}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100">
                      {p.projectName}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                      {p.format.replace('_', '-')}
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {p.slotType === 'analytics_backed_slot'
                        ? 'Analytics-Backed Slot'
                        : 'Testing Upload Slot'}
                    </td>
                    <td className="py-3 px-4">
                      <select
                        value={p.status}
                        onChange={(e) =>
                          handleUpdateProjectStatus(p, e.target.value as ContentProject['status'])
                        }
                        className="px-2.5 py-1 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
                      >
                        <option value="draft">Draft</option>
                        <option value="researching">Researching</option>
                        <option value="scripting">Scripting</option>
                        <option value="production">Filming / Production</option>
                        <option value="ready_to_publish">Ready to Publish</option>
                        <option value="published">Published</option>
                      </select>
                    </td>
                    <td className="py-3 px-4 text-right space-x-3">
                      <button
                        type="button"
                        onClick={() => onNavigate('script-studio', p.projectName)}
                        className="text-rose-600 dark:text-rose-400 font-medium hover:underline"
                      >
                        Open Script
                      </button>
                      <button
                        type="button"
                        onClick={() => setProjectToDelete(p)}
                        className="text-slate-400 hover:text-red-600 inline-flex items-center"
                        title="Delete Project"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
