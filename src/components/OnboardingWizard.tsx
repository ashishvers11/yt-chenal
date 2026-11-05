import React, { useState } from 'react';
import { Youtube, Globe, Sparkles, Check, ArrowRight, RefreshCw } from 'lucide-react';
import {
  connectYouTubeWithOAuth,
  db,
  doc,
  setDoc,
  OperationType,
  handleFirestoreError,
  makeSafeId,
  clampStr,
  recordAiUsage,
  recordAuditLog,
  apiFetch,
} from '../lib/firebase';
import {
  Workspace,
  ChannelProfile,
  YouTubeConnection,
  ChannelVideo,
} from '../types';

interface OnboardingWizardProps {
  uid: string;
  userEmail: string;
  userDisplayName: string;
  existingWorkspace: Workspace | null;
  onComplete: (workspace: Workspace, profile: ChannelProfile) => void;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  uid,
  userEmail,
  userDisplayName,
  existingWorkspace,
  onComplete,
}) => {
  const [step, setStep] = useState<number>(2);
  const [connectionOption, setConnectionOption] = useState<'public_url' | 'oauth' | 'new_creator'>('public_url');
  const [channelInput, setChannelInput] = useState<string>('');
  const [includeAnalyticsScope, setIncludeAnalyticsScope] = useState<boolean>(true);
  const [creatorGoals, setCreatorGoals] = useState<string>(
    'Build consistent authority, improve audience retention, and discover research-backed video ideas.'
  );
  const [newCreatorNicheIdea, setNewCreatorNicheIdea] = useState<string>(
    'Practical Technology & AI Workflows explained simply for beginners'
  );
  const [newCreatorLanguage, setNewCreatorLanguage] = useState<string>('English');
  const [newCreatorFormat, setNewCreatorFormat] = useState<string>('Long-form + Shorts');

  const [discoveredChannel, setDiscoveredChannel] = useState<any | null>(null);
  const [oauthChannels, setOauthChannels] = useState<any[]>([]);
  const [oauthGrantedScopes, setOauthGrantedScopes] = useState<string[]>([]);

  const [draftProfile, setDraftProfile] = useState<{
    channelName: string;
    channelHandle: string;
    channelId: string;
    country: string;
    niche: string;
    subNiches: string[];
    language: string;
    format: string;
    audienceProfile: string;
    positioning: string;
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    recommendations: string[];
    subscriberCount: number;
    totalViews: number;
    videoCount: number;
    confidence: 'high' | 'medium' | 'low' | 'new_creator_estimate';
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Step 2 -> Step 3: Discover Channel via URL or OAuth or New Creator Mode
  const handlePublicDiscovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelInput.trim()) {
      setErrorMsg('Please enter a public YouTube channel URL, @handle, or channel name.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/v1/youtube/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelUrlOrHandle: channelInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not discover channel.');

      if (data.usage) {
        await recordAiUsage(uid, existingWorkspace?.workspaceId || 'onboarding', data.usage);
      }

      setDiscoveredChannel(data.channel);
      setStep(3);
    } catch (err: any) {
      setErrorMsg(err.message || 'Channel discovery failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthConnect = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { accessToken, scopes } = await connectYouTubeWithOAuth(includeAnalyticsScope);
      setOauthGrantedScopes(scopes);

      const res = await apiFetch('/api/v1/youtube/channels', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to list YouTube channels.');

      if (!data.channels || data.channels.length === 0) {
        // Channel has no YouTube channel initialized yet -> offer New Creator Mode
        setConnectionOption('new_creator');
        setErrorMsg(
          'Your Google account does not have an active YouTube channel with uploads yet. Switched to New Creator Mode so we can build your channel foundation from scratch.'
        );
        return;
      }

      setOauthChannels(data.channels);
      setDiscoveredChannel(data.channels[0]);
      setStep(3);
    } catch (err: any) {
      setErrorMsg(err.message || 'OAuth channel connection failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartNewCreatorDiscovery = () => {
    const channelObj = {
      channelId: `new_creator_${uid.slice(0, 8)}`,
      channelName: `${userDisplayName || 'Creator'}'s Studio`,
      channelHandle: `@${(userDisplayName || 'newcreator').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`,
      description: newCreatorNicheIdea,
      country: 'Global',
      language: newCreatorLanguage,
      subscriberCount: 0,
      totalViews: 0,
      videoCount: 0,
      recentVideos: [],
      connectionMode: 'new_creator',
    };
    setDiscoveredChannel(channelObj);
    setStep(3);
  };

  // Step 3 -> Step 4: Run AI Channel Analysis
  const handleGenerateAiProfile = async () => {
    if (!discoveredChannel) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const isNewCreator =
        connectionOption === 'new_creator' || Number(discoveredChannel.videoCount || 0) === 0;

      const res = await apiFetch('/api/v1/channel/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelData: discoveredChannel,
          creatorGoals: `${creatorGoals} | Format: ${newCreatorFormat} | Language: ${newCreatorLanguage}`,
          isNewCreator,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Channel intelligence analysis failed.');

      if (data.usage) {
        await recordAiUsage(uid, existingWorkspace?.workspaceId || 'onboarding', data.usage);
      }

      const p = data.profile;
      setDraftProfile({
        channelName: discoveredChannel.channelName || 'Creator Channel',
        channelHandle: discoveredChannel.channelHandle || '@creator',
        channelId: discoveredChannel.channelId || `ch_${Date.now()}`,
        country: discoveredChannel.country || 'Global',
        niche: p.niche || newCreatorNicheIdea,
        subNiches: Array.isArray(p.subNiches) ? p.subNiches : ['Tutorials', 'Case Studies'],
        language: p.language || newCreatorLanguage || 'English',
        format: p.format || newCreatorFormat || 'Long-form + Shorts',
        audienceProfile: p.audienceProfile || 'Curious learners looking for structured, practical guidance.',
        positioning: p.positioning || 'Evidence-backed creator channel.',
        strengths: Array.isArray(p.strengths) ? p.strengths : ['Clear topic focus'],
        weaknesses: Array.isArray(p.weaknesses) ? p.weaknesses : ['Needs consistent upload cadence'],
        opportunities: Array.isArray(p.opportunities) ? p.opportunities : ['Underserved beginner questions'],
        recommendations: Array.isArray(p.recommendations) ? p.recommendations : ['Publish 1 structured video per week'],
        subscriberCount: Number(discoveredChannel.subscriberCount || 0),
        totalViews: Number(discoveredChannel.totalViews || 0),
        videoCount: Number(discoveredChannel.videoCount || 0),
        confidence: ['high', 'medium', 'low', 'new_creator_estimate'].includes(p.confidence)
          ? p.confidence
          : isNewCreator
          ? 'new_creator_estimate'
          : 'medium',
      });
      setStep(4);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to generate AI Channel Profile.');
    } finally {
      setLoading(false);
    }
  };

  // Step 4 -> Step 5: Confirm & Persist Workspace + Connection + Profile + Videos
  const handleFinalizeWorkspace = async () => {
    if (!draftProfile) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const now = new Date().toISOString();
      const workspaceId = existingWorkspace?.workspaceId || `ws_${uid.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 40)}`;
      const isNewCreator =
        connectionOption === 'new_creator' || draftProfile.videoCount === 0;

      const workspaceDoc: Workspace = {
        workspaceId,
        ownerUid: uid,
        channelId: clampStr(draftProfile.channelId, 128, 'unlinked'),
        workspaceName: clampStr(`${draftProfile.channelName} Workspace`, 140, 'My Creator Workspace'),
        mode: isNewCreator ? 'new_creator' : 'standard',
        createdAt: existingWorkspace?.createdAt || now,
        updatedAt: now,
      };

      try {
        await setDoc(doc(db, 'workspaces', workspaceId), workspaceDoc);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `workspaces/${workspaceId}`);
      }

      const connectionId = `conn_${workspaceId}`;
      const connectionDoc: YouTubeConnection = {
        connectionId,
        ownerUid: uid,
        workspaceId,
        channelId: clampStr(draftProfile.channelId, 128, 'unlinked'),
        channelHandle: clampStr(draftProfile.channelHandle, 120, '@creator'),
        channelTitle: clampStr(draftProfile.channelName, 200, 'Creator Channel'),
        connectionMode:
          connectionOption === 'oauth'
            ? 'oauth_connected'
            : connectionOption === 'new_creator'
            ? 'new_creator'
            : 'public_url',
        grantedScopes: clampStr(oauthGrantedScopes.join(', '), 1000, 'public_metadata_only'),
        connectionStatus:
          connectionOption === 'oauth' ? 'connected' : 'public_only',
        updatedAt: now,
      };

      try {
        await setDoc(doc(db, 'youtubeConnections', connectionId), connectionDoc);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `youtubeConnections/${connectionId}`);
      }

      const profileDoc: ChannelProfile = {
        workspaceId,
        ownerUid: uid,
        channelName: clampStr(draftProfile.channelName, 200, 'Creator Channel'),
        channelHandle: clampStr(draftProfile.channelHandle, 120, '@creator'),
        channelId: clampStr(draftProfile.channelId, 128, 'ch_default'),
        country: clampStr(draftProfile.country, 80, 'Global'),
        niche: clampStr(draftProfile.niche, 200, 'General Creator'),
        subNiches: clampStr(JSON.stringify(draftProfile.subNiches), 1000, '[]'),
        language: clampStr(draftProfile.language, 100, 'English'),
        format: clampStr(draftProfile.format, 120, 'Long-form + Shorts'),
        audienceProfile: clampStr(draftProfile.audienceProfile, 3000, 'General audience'),
        positioning: clampStr(draftProfile.positioning, 2000, 'Original educational creator'),
        strengths: clampStr(JSON.stringify(draftProfile.strengths), 3000, '[]'),
        weaknesses: clampStr(JSON.stringify(draftProfile.weaknesses), 3000, '[]'),
        opportunities: clampStr(JSON.stringify(draftProfile.opportunities), 3000, '[]'),
        recommendations: clampStr(JSON.stringify(draftProfile.recommendations), 3000, '[]'),
        subscriberCount: Math.max(0, Number(draftProfile.subscriberCount || 0)),
        totalViews: Math.max(0, Number(draftProfile.totalViews || 0)),
        videoCount: Math.max(0, Number(draftProfile.videoCount || 0)),
        confidence: draftProfile.confidence,
        isConfirmed: true,
        lastAnalyzedAt: now,
        updatedAt: now,
      };

      try {
        await setDoc(doc(db, 'channelProfiles', workspaceId), profileDoc);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `channelProfiles/${workspaceId}`);
      }

      // Persist discovered public videos if present
      const recentVideos = Array.isArray(discoveredChannel?.recentVideos)
        ? discoveredChannel.recentVideos.slice(0, 8)
        : [];
      for (const v of recentVideos) {
        const videoDocId = makeSafeId('vid');
        const vidDoc: ChannelVideo = {
          videoDocId,
          workspaceId,
          ownerUid: uid,
          videoId: clampStr(v.videoId || videoDocId, 128, videoDocId),
          title: clampStr(v.title, 300, 'Untitled Upload'),
          description: clampStr(v.description || '', 5000, ''),
          publishedAt: clampStr(v.publishedAt || now, 64, now),
          format: v.format === 'shorts' ? 'shorts' : 'long_form',
          topic: clampStr(v.topic || draftProfile.niche, 200, draftProfile.niche),
          views: Math.max(0, Number(v.views || 0)),
          likes: Math.max(0, Number(v.likes || 0)),
          comments: Math.max(0, Number(v.comments || 0)),
          avgViewDurationSec: 0,
          avgPercentageViewed: 0,
          ctr: 0,
          dataSource: 'youtube_public_api',
          createdAt: now,
        };
        try {
          await setDoc(doc(db, 'videos', videoDocId), vidDoc);
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `videos/${videoDocId}`);
        }
      }

      await recordAuditLog(
        uid,
        userEmail,
        'channel_onboarding_completed',
        `workspaces/${workspaceId}`,
        `Connected channel ${profileDoc.channelName} (${connectionDoc.connectionMode})`
      );

      onComplete(workspaceDoc, profileDoc);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save workspace.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto py-8 px-6 sm:px-10 box-border">
      <div className="mb-8">
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Step {step} of 5 · Creator Workspace Onboarding
        </div>
        <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Set Up Your ASH Creator Studio Workspace
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Connect a public YouTube URL, authorize your channel via Google OAuth 2.0, or launch in New Creator Mode if you have not published your first video yet.
        </p>
      </div>

      {/* Stepper indicator */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8 pb-6 border-b border-slate-200 dark:border-slate-800 text-xs">
        {[
          { num: 2, label: '01. Connect Channel' },
          { num: 3, label: '02. Discover Metadata' },
          { num: 4, label: '03. Confirm AI Profile' },
          { num: 5, label: '04. Launch Studio' },
        ].map((item) => (
          <div
            key={item.num}
            className={`py-2 px-3 rounded-lg border ${
              step === item.num
                ? 'border-rose-600 bg-rose-50/60 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 font-semibold'
                : step > item.num
                ? 'border-emerald-600/40 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300'
                : 'border-slate-200 dark:border-slate-800 text-slate-500'
            }`}
          >
            {item.label}
          </div>
        ))}
      </div>

      {errorMsg && (
        <div className="mb-6 p-4 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300 break-words">
          {errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('"code":429')
            ? 'Gemini API rate limit reached on your current tier. Please try again in a few seconds—public channel discovery has been switched to direct YouTube resolution.'
            : errorMsg}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          {/* Segmented Selector */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 w-fit">
            <button
              type="button"
              onClick={() => {
                setConnectionOption('public_url');
                setErrorMsg(null);
              }}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                connectionOption === 'public_url'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Option A: Public Channel URL / @Handle
            </button>
            <button
              type="button"
              onClick={() => {
                setConnectionOption('oauth');
                setErrorMsg(null);
              }}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                connectionOption === 'oauth'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Option B: Google OAuth 2.0 (With Analytics)
            </button>
            <button
              type="button"
              onClick={() => {
                setConnectionOption('new_creator');
                setErrorMsg(null);
              }}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                connectionOption === 'new_creator'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              New Creator Mode (0 Videos)
            </button>
          </div>

          {connectionOption === 'public_url' && (
            <form
              onSubmit={handlePublicDiscovery}
              className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Globe className="w-4 h-4 text-rose-600" />
                <span>Analyze Any Public YouTube Channel</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Enter your YouTube channel URL, `@handle`, or channel name. Public URLs enable full public channel intelligence, niche discovery, and script generation without granting private analytics access.
              </p>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  YouTube Channel URL or @Handle
                </label>
                <input
                  type="text"
                  value={channelInput}
                  onChange={(e) => setChannelInput(e.target.value)}
                  placeholder="e.g., @veritasium, @mkbhd, or https://www.youtube.com/@fireship"
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  <span>Quick test handles:</span>
                  {['@veritasium', '@fireship', '@mkbhd', '@aliabdaal'].map((sample) => (
                    <button
                      key={sample}
                      type="button"
                      onClick={() => {
                        setChannelInput(sample);
                        setErrorMsg(null);
                      }}
                      className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 hover:border-rose-500 transition-colors"
                    >
                      {sample}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Primary Growth Goal
                </label>
                <input
                  type="text"
                  value={creatorGoals}
                  onChange={(e) => setCreatorGoals(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-slate-500">
                  Uses Direct YouTube Public Metadata + XML Feed Discovery
                </span>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Discovering Channel...</span>
                    </>
                  ) : (
                    <>
                      <span>Discover Public Channel</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {connectionOption === 'oauth' && (
            <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Youtube className="w-4 h-4 text-rose-600" />
                <span>Authorize Authenticated Channel via Google OAuth 2.0</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Requests read-only scopes (`youtube.readonly` and optionally `yt-analytics.readonly`). ASH Creator Studio never requests publishing or channel-deletion permissions.
              </p>

              <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeAnalyticsScope}
                  onChange={(e) => setIncludeAnalyticsScope(e.target.checked)}
                  className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <span>
                  Include private YouTube Analytics read access (`yt-analytics.readonly`) for watch time, retention, and subscriber reports
                </span>
              </label>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleOAuthConnect}
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Authorizing with Google...</span>
                    </>
                  ) : (
                    <>
                      <span>Connect Google Account & Select Channel</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {connectionOption === 'new_creator' && (
            <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Sparkles className="w-4 h-4 text-rose-600" />
                <span>New Creator Mode — Launch From Zero Videos</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Designed for brand-new creators with no upload history. We will never fabricate historical analytics—instead, we help you select a sustainable niche, define your target audience, and build your starter 5-video roadmap.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    What topics or skills do you want to make videos about?
                  </label>
                  <input
                    type="text"
                    value={newCreatorNicheIdea}
                    onChange={(e) => setNewCreatorNicheIdea(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Primary Content Language
                  </label>
                  <select
                    value={newCreatorLanguage}
                    onChange={(e) => setNewCreatorLanguage(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    <option value="English">English</option>
                    <option value="Hindi">Hindi</option>
                    <option value="Hinglish">Hinglish (Hindi + English)</option>
                    <option value="Spanish">Spanish</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Planned Video Format
                  </label>
                  <select
                    value={newCreatorFormat}
                    onChange={(e) => setNewCreatorFormat(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    <option value="Long-form + Shorts">Hybrid (Long-form + Shorts)</option>
                    <option value="Long-form Deep Dives">Long-form Only (8–15 mins)</option>
                    <option value="YouTube Shorts">YouTube Shorts Only (Under 60s)</option>
                    <option value="Faceless Documentary">Faceless Documentary</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleStartNewCreatorDiscovery}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <span>Continue in New Creator Mode</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 3 && discoveredChannel && (
        <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="text-xs text-slate-500">
                Discovered Channel Metadata · {discoveredChannel.connectionMode === 'new_creator' ? 'New Creator Mode' : 'Public Data Verified'}
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                {discoveredChannel.channelName} ({discoveredChannel.channelHandle})
              </h2>
            </div>

            {oauthChannels.length > 1 && (
              <select
                value={discoveredChannel.channelId}
                onChange={(e) => {
                  const found = oauthChannels.find((c) => c.channelId === e.target.value);
                  if (found) setDiscoveredChannel(found);
                }}
                className="px-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg"
              >
                {oauthChannels.map((c) => (
                  <option key={c.channelId} value={c.channelId}>
                    {c.channelName} ({c.channelHandle})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
              <div className="text-xs text-slate-500">Subscribers</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {Number(discoveredChannel.subscriberCount || 0).toLocaleString()}
              </div>
            </div>
            <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
              <div className="text-xs text-slate-500">Public Total Views</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {Number(discoveredChannel.totalViews || 0).toLocaleString()}
              </div>
            </div>
            <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
              <div className="text-xs text-slate-500">Uploaded Videos</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {Number(discoveredChannel.videoCount || 0).toLocaleString()}
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-600 dark:text-slate-400">
            <span className="font-semibold text-slate-900 dark:text-slate-200">Description / Concept: </span>
            {discoveredChannel.description || 'No public description provided.'}
          </div>

          {Array.isArray(discoveredChannel.recentVideos) && discoveredChannel.recentVideos.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-200 mb-2">
                Discovered Public Uploads ({discoveredChannel.recentVideos.length})
              </h3>
              <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                {discoveredChannel.recentVideos.slice(0, 5).map((v: any, idx: number) => (
                  <div key={idx} className="px-4 py-2.5 flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-lg">
                      {v.title}
                    </span>
                    <span className="text-slate-500 tabular-nums shrink-0 ml-4">
                      {v.format} · {Number(v.views || 0).toLocaleString()} views
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleGenerateAiProfile}
              disabled={loading}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Running AI Channel Intelligence...</span>
                </>
              ) : (
                <>
                  <span>Generate AI Channel Profile</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {step === 4 && draftProfile && (
        <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-6">
          <div>
            <div className="text-xs text-slate-500">
              AI Proposed Channel Profile · Confidence: {draftProfile.confidence}
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
              Review & Confirm Your Channel Positioning
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Edit any field below if the AI inferred something uncertain. Every research agent, script writer, and growth recommendation will use this confirmed profile.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Channel Name
              </label>
              <input
                type="text"
                value={draftProfile.channelName}
                onChange={(e) => setDraftProfile({ ...draftProfile, channelName: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Primary Niche
              </label>
              <input
                type="text"
                value={draftProfile.niche}
                onChange={(e) => setDraftProfile({ ...draftProfile, niche: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Primary Language
              </label>
              <input
                type="text"
                value={draftProfile.language}
                onChange={(e) => setDraftProfile({ ...draftProfile, language: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Video Formats
              </label>
              <input
                type="text"
                value={draftProfile.format}
                onChange={(e) => setDraftProfile({ ...draftProfile, format: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Sub-Niches (Comma separated)
              </label>
              <input
                type="text"
                value={draftProfile.subNiches.join(', ')}
                onChange={(e) =>
                  setDraftProfile({
                    ...draftProfile,
                    subNiches: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  })
                }
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Target Audience Profile (Estimated viewer interests & expectations)
              </label>
              <textarea
                rows={2}
                value={draftProfile.audienceProfile}
                onChange={(e) => setDraftProfile({ ...draftProfile, audienceProfile: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Channel Positioning Statement
              </label>
              <textarea
                rows={2}
                value={draftProfile.positioning}
                onChange={(e) => setDraftProfile({ ...draftProfile, positioning: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
            <div>
              <div className="font-semibold text-slate-900 dark:text-slate-200 mb-1">
                Identified Strengths
              </div>
              <ul className="space-y-1 text-slate-600 dark:text-slate-400">
                {draftProfile.strengths.map((s, i) => (
                  <li key={i}>• {s}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-semibold text-slate-900 dark:text-slate-200 mb-1">
                Top Content Opportunities
              </div>
              <ul className="space-y-1 text-slate-600 dark:text-slate-400">
                {draftProfile.opportunities.map((o, i) => (
                  <li key={i}>• {o}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleFinalizeWorkspace}
              disabled={loading}
              className="inline-flex items-center gap-2 px-6 py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Workspace...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Confirm Profile & Launch Workspace</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
