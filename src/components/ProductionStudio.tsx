import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  FileText,
  Film,
  Image as ImageIcon,
  Search,
  Volume2,
  RefreshCw,
  ArrowRight,
  Copy,
  Check,
  CalendarPlus,
} from 'lucide-react';
import {
  ChannelProfile,
  ContentIdea,
  ScriptDocument,
  ContentProject,
  NavSectionId,
} from '../types';
import {
  db,
  doc,
  setDoc,
  updateDoc,
  OperationType,
  handleFirestoreError,
  makeSafeId,
  clampStr,
  recordAiUsage,
} from '../lib/firebase';
import { ModuleBanner } from './ModuleBanner';

interface ProductionStudioProps {
  activeTab: 'content-ideas' | 'script-studio' | 'visual-studio' | 'thumbnail-studio' | 'seo-studio';
  uid: string;
  workspaceId: string;
  channelProfile: ChannelProfile | null;
  ideas: ContentIdea[];
  scripts: ScriptDocument[];
  prefillTopic?: string;
  onNavigate: (tab: NavSectionId, topicPrefill?: string) => void;
}

export const ProductionStudio: React.FC<ProductionStudioProps> = ({
  activeTab,
  uid,
  workspaceId,
  channelProfile,
  ideas,
  scripts,
  prefillTopic,
  onNavigate,
}) => {
  // Opportunity Engine State
  const [focusTopic, setFocusTopic] = useState(prefillTopic || channelProfile?.niche || '');
  const [formatPref, setFormatPref] = useState<'both' | 'long_form' | 'shorts' | 'series'>('both');
  const [weights, setWeights] = useState({
    audienceRelevance: 25,
    researchEvidence: 20,
    originality: 20,
    channelFit: 20,
    productionFeasibility: 15,
  });
  const [showWeights, setShowWeights] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Script Studio State
  const [scriptTopic, setScriptTopic] = useState(prefillTopic || '');
  const [selectedIdeaId, setSelectedIdeaId] = useState('');
  const [scriptLanguage, setScriptLanguage] = useState(channelProfile?.language || 'English');
  const [scriptFormat, setScriptFormat] = useState<'long_form' | 'shorts'>('long_form');
  const [targetDuration, setTargetDuration] = useState('8-10 minutes');
  const [visualStyle, setVisualStyle] = useState('Documentary');
  const [creatorInstructions, setCreatorInstructions] = useState('');

  const [selectedScriptId, setSelectedScriptId] = useState<string>('');
  const [editedScriptBody, setEditedScriptBody] = useState<string>('');
  const [voiceName, setVoiceName] = useState<string>('Kore');
  const [audioDataUrl, setAudioDataUrl] = useState<string | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (prefillTopic) {
      setFocusTopic(prefillTopic);
      setScriptTopic(prefillTopic);
    }
  }, [prefillTopic]);

  const activeScript = scripts.find((s) => s.scriptId === selectedScriptId) || scripts[0] || null;

  useEffect(() => {
    if (activeScript) {
      setSelectedScriptId(activeScript.scriptId);
      setEditedScriptBody(activeScript.scriptContent);
    }
  }, [activeScript?.scriptId]);

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  // Generate Content Opportunities (Module 6 & 7)
  const handleGenerateIdeas = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/v1/ideas/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelProfile,
          focusTopic: focusTopic.trim() || channelProfile?.niche || 'High-value creator video topics',
          formatPreference: formatPref,
          weights,
          count: 4,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate content opportunities.');

      if (data.usage) {
        await recordAiUsage(uid, workspaceId, data.usage);
      }

      const now = new Date().toISOString();
      for (const item of data.ideas || []) {
        const ideaId = makeSafeId('idea');
        const ideaDoc: ContentIdea = {
          ideaId,
          workspaceId,
          ownerUid: uid,
          title: clampStr(item.title, 300, 'Untitled Opportunity'),
          description: clampStr(item.description, 3000, 'Content opportunity.'),
          category: clampStr(item.category, 100, 'Educational'),
          format: ['long_form', 'shorts', 'series'].includes(item.format) ? item.format : 'long_form',
          evidence: clampStr(item.evidence, 3000, 'Topic demand signal.'),
          competitionLevel: ['low', 'medium', 'high'].includes(item.competitionLevel)
            ? item.competitionLevel
            : 'medium',
          originalAngle: clampStr(item.originalAngle, 2000, 'Original perspective.'),
          difficulty: ['beginner', 'intermediate', 'advanced'].includes(item.difficulty)
            ? item.difficulty
            : 'intermediate',
          risks: clampStr(item.risks, 2000, 'Standard execution risk.'),
          audienceRelevanceScore: Math.max(0, Math.min(100, Number(item.audienceRelevanceScore || 75))),
          researchEvidenceScore: Math.max(0, Math.min(100, Number(item.researchEvidenceScore || 75))),
          originalityScore: Math.max(0, Math.min(100, Number(item.originalityScore || 75))),
          channelFitScore: Math.max(0, Math.min(100, Number(item.channelFitScore || 75))),
          productionFeasibilityScore: Math.max(
            0,
            Math.min(100, Number(item.productionFeasibilityScore || 75))
          ),
          opportunityScore: Math.max(0, Math.min(100, Number(item.opportunityScore || 75))),
          status: 'saved',
          createdAt: now,
          updatedAt: now,
        };
        try {
          await setDoc(doc(db, 'contentIdeas', ideaId), ideaDoc);
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `contentIdeas/${ideaId}`);
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Opportunity generation failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateIdeaStatus = async (idea: ContentIdea, status: ContentIdea['status']) => {
    const path = `contentIdeas/${idea.ideaId}`;
    try {
      await updateDoc(doc(db, 'contentIdeas', idea.ideaId), {
        status,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleScheduleIdeaToCalendar = async (idea: ContentIdea) => {
    const projectId = makeSafeId('proj');
    const now = new Date().toISOString();
    const nextWeekDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const projDoc: ContentProject = {
      projectId,
      workspaceId,
      ownerUid: uid,
      projectName: clampStr(idea.title, 240, 'Scheduled Video'),
      topic: clampStr(idea.description, 300, idea.title),
      format: idea.format,
      status: 'scripting',
      scheduledDate: nextWeekDate,
      slotType: 'testing_slot',
      ideaId: idea.ideaId,
      scriptId: '',
      notes: clampStr(`Original Angle: ${idea.originalAngle}`, 5000, ''),
      createdAt: now,
      updatedAt: now,
    };

    try {
      await setDoc(doc(db, 'projects', projectId), projDoc);
      await handleUpdateIdeaStatus(idea, 'selected');
      onNavigate('content-calendar');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `projects/${projectId}`);
    }
  };

  // Generate Complete Production Script Package (Modules 9, 10, 12, 13, 14, 15)
  const handleGenerateScriptPackage = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetTopic = scriptTopic.trim() || channelProfile?.niche || 'How to build a repeatable workflow';
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/v1/scripts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: targetTopic,
          targetAudience: channelProfile?.audienceProfile,
          format: scriptFormat,
          language: scriptLanguage,
          targetDuration,
          visualStyle,
          creatorInstructions,
          channelProfile,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Script generation failed.');

      if (data.usage) {
        await recordAiUsage(uid, workspaceId, data.usage);
      }

      const pkg = data.scriptPackage;
      const scriptId = makeSafeId('scr');
      const now = new Date().toISOString();

      const scriptDoc: ScriptDocument = {
        scriptId,
        workspaceId,
        ownerUid: uid,
        ideaId: clampStr(selectedIdeaId, 128, 'custom_topic'),
        title: clampStr(pkg.title || targetTopic, 300, targetTopic),
        language: clampStr(scriptLanguage, 80, 'English'),
        format: scriptFormat,
        targetDuration: clampStr(targetDuration, 80, '8-10 minutes'),
        style: clampStr(visualStyle, 160, 'Documentary'),
        hooks: clampStr(JSON.stringify(pkg.hooks || []), 10000, '[]'),
        scriptContent: clampStr(pkg.scriptContent || '', 50000, 'Script generated.'),
        storyStructure: clampStr(JSON.stringify(pkg.storyStructure || []), 10000, '[]'),
        curiosityGaps: clampStr(JSON.stringify(pkg.curiosityGaps || []), 5000, '[]'),
        ctaOptions: clampStr(JSON.stringify(pkg.ctaOptions || []), 5000, '[]'),
        scenes: clampStr(JSON.stringify(pkg.scenes || []), 40000, '[]'),
        seoData: clampStr(JSON.stringify(pkg.seoData || {}), 15000, '{}'),
        thumbnailConcepts: clampStr(JSON.stringify(pkg.thumbnailConcepts || []), 15000, '[]'),
        voiceoverNotes: clampStr(JSON.stringify(pkg.voiceoverNotes || {}), 15000, '{}'),
        version: 1,
        createdAt: now,
        updatedAt: now,
      };

      try {
        await setDoc(doc(db, 'scripts', scriptId), scriptDoc);
        setSelectedScriptId(scriptId);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `scripts/${scriptId}`);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to generate production package.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEditedScript = async () => {
    if (!activeScript) return;
    const path = `scripts/${activeScript.scriptId}`;
    try {
      await updateDoc(doc(db, 'scripts', activeScript.scriptId), {
        scriptContent: clampStr(editedScriptBody, 50000, activeScript.scriptContent),
        version: Number(activeScript.version || 1) + 1,
        updatedAt: new Date().toISOString(),
      });
      copyText(editedScriptBody, 'saved_script');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleSynthesizeVoiceover = async () => {
    if (!activeScript) return;
    setTtsLoading(true);
    setErrorMsg(null);
    try {
      const textToSpeak = editedScriptBody || activeScript.scriptContent;
      const res = await fetch('/api/v1/voiceover/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToSpeak,
          voiceName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Voiceover synthesis failed.');

      if (data.usage) {
        await recordAiUsage(uid, workspaceId, data.usage);
      }
      setAudioDataUrl(data.audioDataUrl);

      if (data.fallbackBrowserSpeech && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(textToSpeak.slice(0, 600));
          utterance.rate = 1.02;
          window.speechSynthesis.speak(utterance);
        } catch {
          // Ignore browser speech synthesis errors
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Voiceover synthesis failed.');
    } finally {
      setTtsLoading(false);
    }
  };

  // Parse active script sub-objects safely
  let parsedHooks: any[] = [];
  let parsedStructure: any[] = [];
  let parsedCuriosityGaps: string[] = [];
  let parsedScenes: any[] = [];
  let parsedThumbnails: any[] = [];
  let parsedSeo: any = {};
  let parsedVoiceover: any = {};

  if (activeScript) {
    try { parsedHooks = JSON.parse(activeScript.hooks || '[]'); } catch { parsedHooks = []; }
    try { parsedStructure = JSON.parse(activeScript.storyStructure || '[]'); } catch { parsedStructure = []; }
    try { parsedCuriosityGaps = JSON.parse(activeScript.curiosityGaps || '[]'); } catch { parsedCuriosityGaps = []; }
    try { parsedScenes = JSON.parse(activeScript.scenes || '[]'); } catch { parsedScenes = []; }
    try { parsedThumbnails = JSON.parse(activeScript.thumbnailConcepts || '[]'); } catch { parsedThumbnails = []; }
    try { parsedSeo = JSON.parse(activeScript.seoData || '{}'); } catch { parsedSeo = {}; }
    try { parsedVoiceover = JSON.parse(activeScript.voiceoverNotes || '{}'); } catch { parsedVoiceover = {}; }
  }

  // -------------------------------------------------------------------------
  // TAB 1: CONTENT IDEAS & OPPORTUNITY ENGINE (Modules 6 & 7)
  // -------------------------------------------------------------------------
  if (activeTab === 'content-ideas') {
    const visibleIdeas =
      statusFilter === 'all' ? ideas : ideas.filter((i) => i.status === statusFilter);

    return (
      <div>
        <ModuleBanner
          title="AI Content Opportunity Engine & Idea Generator"
          whatItDoes="Combines your channel profile, audience demand signals, competitor gaps, and production difficulty to rank original video concepts."
          whyItMatters="Instead of guessing what to film next, you can compare ideas using a transparent 5-factor weighted scoring model."
          howToUse="Enter a topic angle or leave blank to use your channel profile, adjust the scoring weights if needed, and click Generate Opportunities."
          exampleOutput="Weighted Score: 84/100 (Audience Relevance 25% · Research Evidence 20% · Originality 20% · Channel Fit 20% · Feasibility 15%)."
          nextActionLabel="Open Script Studio"
          onNextAction={() => onNavigate('script-studio')}
        />

        <form
          onSubmit={handleGenerateIdeas}
          className="mb-8 p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Topic Focus or Audience Question
              </label>
              <input
                type="text"
                value={focusTopic}
                onChange={(e) => setFocusTopic(e.target.value)}
                placeholder="e.g., Beginner mistakes, myth-busting, budget workflows, or series concepts..."
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Target Format
              </label>
              <select
                value={formatPref}
                onChange={(e) => setFormatPref(e.target.value as any)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              >
                <option value="both">Long-form + Shorts Mix</option>
                <option value="long_form">Long-form Deep Dives</option>
                <option value="shorts">YouTube Shorts</option>
                <option value="series">Multi-Part Series</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Scoring Opportunities...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Generate Ranked Ideas</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 dark:border-slate-800 text-xs">
            <span className="text-slate-500">
              Transparent Opportunity Score (Not a prediction of guaranteed views): Relevance {weights.audienceRelevance}% · Evidence {weights.researchEvidence}% · Originality {weights.originality}% · Channel Fit {weights.channelFit}% · Feasibility {weights.productionFeasibility}%
            </span>
            <button
              type="button"
              onClick={() => setShowWeights((v) => !v)}
              className="font-medium text-rose-600 dark:text-rose-400 hover:underline"
            >
              {showWeights ? 'Hide Weight Sliders' : 'Configure Scoring Weights'}
            </button>
          </div>

          {showWeights && (
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 pt-3 text-xs">
              {[
                { key: 'audienceRelevance', label: 'Audience Relevance' },
                { key: 'researchEvidence', label: 'Research Evidence' },
                { key: 'originality', label: 'Originality' },
                { key: 'channelFit', label: 'Channel Fit' },
                { key: 'productionFeasibility', label: 'Feasibility' },
              ].map((wItem) => (
                <div key={wItem.key}>
                  <div className="flex justify-between mb-1">
                    <span>{wItem.label}</span>
                    <span className="tabular-nums font-semibold">
                      {(weights as any)[wItem.key]}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={50}
                    step={5}
                    value={(weights as any)[wItem.key]}
                    onChange={(e) =>
                      setWeights({ ...weights, [wItem.key]: Number(e.target.value) })
                    }
                    className="w-full accent-rose-600"
                  />
                </div>
              ))}
            </div>
          )}
        </form>

        {errorMsg && (
          <div className="mb-6 p-4 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        {/* Filter Bar */}
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
            {['all', 'saved', 'selected', 'scripting', 'published'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize whitespace-nowrap shrink-0 ${
                  statusFilter === st
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
          <div className="text-xs text-slate-500 tabular-nums">
            Showing {visibleIdeas.length} of {ideas.length} ranked opportunities
          </div>
        </div>

        {visibleIdeas.length === 0 ? (
          <div className="p-10 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              No Content Opportunities Saved Yet
            </h3>
            <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
              Click Generate Ranked Ideas above to run the AI Content Opportunity Engine for your channel profile.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleIdeas.map((idea) => (
              <div
                key={idea.ideaId}
                className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4"
              >
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div className="space-y-1">
                    {/* Clean unboxed metadata per Zero-Pill rule */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{idea.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>Format: {idea.format.replace('_', '-')}</span>
                      <span aria-hidden="true">·</span>
                      <span>Competition: {idea.competitionLevel}</span>
                      <span aria-hidden="true">·</span>
                      <span>Difficulty: {idea.difficulty}</span>
                      <span aria-hidden="true">·</span>
                      <span>Status: {idea.status}</span>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      {idea.title}
                    </h3>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <div className="text-xs text-slate-500">Opportunity Index</div>
                      <div className="text-xl font-bold tabular-nums text-rose-600 dark:text-rose-400">
                        {idea.opportunityScore}/100
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setScriptTopic(idea.title);
                        setSelectedIdeaId(idea.ideaId);
                        handleUpdateIdeaStatus(idea, 'scripting');
                        onNavigate('script-studio', idea.title);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <span>Write Script</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  {idea.description}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-200 mb-0.5">
                      Supporting Research Evidence
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">{idea.evidence}</p>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-200 mb-0.5">
                      Original Angle
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">{idea.originalAngle}</p>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-200 mb-0.5">
                      Risks & Uncertainties
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">{idea.risks}</p>
                  </div>
                </div>

                {/* Transparent Sub-Score Breakdown */}
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500 tabular-nums">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>Audience Relevance: {idea.audienceRelevanceScore}</span>
                    <span>·</span>
                    <span>Evidence: {idea.researchEvidenceScore}</span>
                    <span>·</span>
                    <span>Originality: {idea.originalityScore}</span>
                    <span>·</span>
                    <span>Channel Fit: {idea.channelFitScore}</span>
                    <span>·</span>
                    <span>Feasibility: {idea.productionFeasibilityScore}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onNavigate('retention-coach', idea.title)}
                      className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 underline"
                    >
                      Fact-Check Topic
                    </button>
                    <button
                      type="button"
                      onClick={() => handleScheduleIdeaToCalendar(idea)}
                      className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium hover:underline"
                    >
                      <CalendarPlus className="w-3.5 h-3.5" />
                      <span>Schedule to Calendar</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // SHARED SCRIPT SELECTOR TOOLBAR FOR SCRIPT / VISUAL / THUMBNAIL / SEO STUDIOS
  // -------------------------------------------------------------------------
  const ScriptSelectorBar = () => (
    <div className="mb-6 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
          Active Video Package:
        </span>
        {scripts.length > 0 ? (
          <select
            value={activeScript?.scriptId || ''}
            onChange={(e) => setSelectedScriptId(e.target.value)}
            className="w-full sm:w-auto max-w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 truncate"
          >
            {scripts.map((s) => (
              <option key={s.scriptId} value={s.scriptId}>
                VIDEO: {s.title} ({s.language} · {s.format})
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-slate-500">No video script generated yet</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => onNavigate('script-studio')}
          className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap shrink-0 ${
            activeTab === 'script-studio'
              ? 'bg-rose-600 text-white'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          Video Script & Hooks
        </button>
        <button
          type="button"
          onClick={() => onNavigate('visual-studio')}
          className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap shrink-0 ${
            activeTab === 'visual-studio'
              ? 'bg-rose-600 text-white'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          Visual Director
        </button>
        <button
          type="button"
          onClick={() => onNavigate('thumbnail-studio')}
          className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap shrink-0 ${
            activeTab === 'thumbnail-studio'
              ? 'bg-rose-600 text-white'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          Thumbnail & Voiceover
        </button>
        <button
          type="button"
          onClick={() => onNavigate('seo-studio')}
          className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap shrink-0 ${
            activeTab === 'seo-studio'
              ? 'bg-rose-600 text-white'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          SEO Studio
        </button>
      </div>
    </div>
  );

  // -------------------------------------------------------------------------
  // TAB 2: VIDEO SCRIPT STUDIO & HOOK OPTIMIZER (Modules 9 & 10)
  // -------------------------------------------------------------------------
  if (activeTab === 'script-studio') {
    return (
      <div>
        <ModuleBanner
          title="Video — Script Studio & Hook Optimizer"
          whatItDoes="Generates complete, original video scripts in English, Hindi, Hinglish, or regional languages with non-clickbait Hook Optimizer scores, story structure, curiosity gaps, and CTA payoffs."
          whyItMatters="Strong opening clarity and deliberate curiosity gaps prevent early viewer drop-off while preserving your authentic voice."
          howToUse="Enter your video topic below, pick your language, format (Long-form or Shorts), and visual style, then click Generate Complete Video Script Package."
          exampleOutput="Complete editable VIDEO Script + 3 scored hooks + story structure + automatic Visual Director & SEO packages."
          nextActionLabel="Open Visual Director"
          onNextAction={() => onNavigate('visual-studio')}
        />

        <ScriptSelectorBar />

        {/* Generator Form */}
        <form
          onSubmit={handleGenerateScriptPackage}
          className="mb-8 p-4 sm:p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-bold tracking-wider uppercase text-rose-600 dark:text-rose-400">
              VIDEO — New Video Script & Production Plan
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Video Topic or Working Title
              </label>
              <input
                type="text"
                value={scriptTopic}
                onChange={(e) => setScriptTopic(e.target.value)}
                placeholder="e.g., How Zero-Knowledge Proofs Work in 8 Minutes (Without Heavy Math)"
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Video Script Language
              </label>
              <select
                value={scriptLanguage}
                onChange={(e) => setScriptLanguage(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              >
                <option value="English">English</option>
                <option value="Hindi">Hindi (हिन्दी)</option>
                <option value="Hinglish">Hinglish (Conversational Hindi + English)</option>
                <option value="Spanish">Spanish</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Video Format
              </label>
              <select
                value={scriptFormat}
                onChange={(e) => {
                  const val = e.target.value as 'long_form' | 'shorts';
                  setScriptFormat(val);
                  setTargetDuration(val === 'shorts' ? '45-60 seconds' : '8-10 minutes');
                }}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              >
                <option value="long_form">Long-Form Video</option>
                <option value="shorts">YouTube Shorts (Vertical)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Target Duration
              </label>
              <input
                type="text"
                value={targetDuration}
                onChange={(e) => setTargetDuration(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Visual Production Format
              </label>
              <select
                value={visualStyle}
                onChange={(e) => setVisualStyle(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              >
                <option value="Documentary">Documentary</option>
                <option value="Talking-Head + B-Roll">Talking-Head + B-Roll</option>
                <option value="Faceless Content">Faceless Content</option>
                <option value="Screen Recordings">Screen Recordings & Demos</option>
                <option value="Animation">2D / 3D Animation</option>
                <option value="Paper Cut-Out Animation">Paper Cut-Out Animation</option>
                <option value="Realistic Visuals">Realistic Cinematic Visuals</option>
                <option value="ASMR">ASMR / Sensory Storytelling</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Creator Instructions (Specific examples, tone, or points to include)
              </label>
              <input
                type="text"
                value={creatorInstructions}
                onChange={(e) => setCreatorInstructions(e.target.value)}
                placeholder="Optional: Start with a real-world failure story, keep pacing brisk, avoid generic intros..."
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full sm:w-auto justify-center inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Orchestrating Video Script, Visuals & SEO...</span>
                </>
              ) : (
                <>
                  <FileText className="w-3.5 h-3.5" />
                  <span>Generate Complete Video Script Package</span>
                </>
              )}
            </button>
          </div>
        </form>

        {errorMsg && (
          <div className="mb-6 p-4 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        {activeScript && (
          <div className="space-y-6">
            {/* Prominent VIDEO Header + Editable Full Video Script + Story Structure */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 p-4 sm:p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
                <div className="pb-3 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className="text-xs font-extrabold tracking-widest uppercase text-rose-600 dark:text-rose-400">
                      VIDEO
                    </div>
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5 break-words">
                      Video Script: {activeScript.title}
                    </h3>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Editable Master Video Script · Version {activeScript.version} · {activeScript.language} · {activeScript.targetDuration}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => copyText(editedScriptBody, 'copy_script')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200"
                    >
                      {copiedKey === 'copy_script' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedKey === 'copy_script' ? 'Copied' : 'Copy Video Script'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEditedScript}
                      className="px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg"
                    >
                      {copiedKey === 'saved_script' ? 'Saved v' + (activeScript.version + 1) : 'Save Edits'}
                    </button>
                  </div>
                </div>

                <textarea
                  rows={18}
                  value={editedScriptBody}
                  onChange={(e) => setEditedScriptBody(e.target.value)}
                  className="w-full p-3.5 sm:p-4 text-sm leading-relaxed bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 font-sans focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="p-4 sm:p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-5 text-xs">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 mb-0.5">
                    VIDEO TIMELINE
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2">
                    Story Structure & Pacing Map
                  </h3>
                  <div className="space-y-3">
                    {parsedStructure.map((st, idx) => (
                      <div
                        key={idx}
                        className="pb-2.5 border-b border-slate-200 dark:border-slate-800 last:border-b-0"
                      >
                        <div className="flex justify-between gap-2 font-semibold text-slate-900 dark:text-slate-100">
                          <span>{st.section}</span>
                          <span className="tabular-nums text-slate-500 shrink-0">{st.timestampEstimate}</span>
                        </div>
                        <div className="text-rose-600 dark:text-rose-400 mt-0.5">{st.purpose}</div>
                        <p className="text-slate-600 dark:text-slate-400 mt-1">{st.summary}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {parsedCuriosityGaps.length > 0 && (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                    <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
                      Built-In Curiosity Gaps
                    </h4>
                    <ul className="space-y-1 text-slate-600 dark:text-slate-400">
                      {parsedCuriosityGaps.map((cg, idx) => (
                        <li key={idx}>• {cg}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Hook Optimizer Panel (Module 10) */}
            <div className="p-4 sm:p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
              <div>
                <div className="text-xs text-slate-500">
                  Module 10 · Video Hook Optimizer Evaluation (Non-Clickbait First-15s Options)
                </div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                  Opening Video Hook Variations for "{activeScript.title}"
                </h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {parsedHooks.map((hk, i) => (
                  <div
                    key={i}
                    className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1 text-slate-500 tabular-nums">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Option {i + 1}: {hk.angle}
                      </span>
                      <span>
                        Clarity {hk.clarityScore}/100 · Curiosity {hk.curiosityScore}/100
                      </span>
                    </div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-relaxed">
                      "{hk.hookText}"
                    </p>
                    <p className="text-slate-600 dark:text-slate-400">
                      <span className="font-semibold">Why it works:</span> {hk.whyItWorks}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // TAB 3: VISUAL DIRECTOR STUDIO (Module 12)
  // -------------------------------------------------------------------------
  if (activeTab === 'visual-studio') {
    return (
      <div>
        <ModuleBanner
          title="Visual Director & Scene Storyboard"
          whatItDoes="Breaks your script into a scene-by-scene production table with camera directions, B-roll descriptions, on-screen text, sound design cues, and ready-to-use AI image/video prompts."
          whyItMatters="Planning every visual change before filming or editing keeps visual momentum high and eliminates dead talking-head stretches."
          howToUse="Select your active script below to inspect each scene's camera direction, or copy the AI image/video prompts for your visual assets."
          nextActionLabel="Open Thumbnail & Voiceover Studio"
          onNextAction={() => onNavigate('thumbnail-studio')}
        />

        <ScriptSelectorBar />

        {!activeScript || parsedScenes.length === 0 ? (
          <div className="p-10 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
            <Film className="w-6 h-6 text-slate-400 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              No Visual Storyboard Scenes Yet
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Generate a production package in Script Studio first to populate your scene-by-scene Visual Director plan.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {parsedScenes.map((scene: any, idx: number) => (
              <div
                key={idx}
                className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800 text-xs">
                  <div className="font-bold text-sm text-slate-900 dark:text-slate-100 tabular-nums">
                    Scene {scene.sceneNumber || idx + 1} · {activeScript.style}
                  </div>
                  <div className="text-slate-500">
                    Camera: {scene.cameraDirection} · Transition: {scene.transition} · Sound: {scene.soundSuggestion}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                    <div className="font-semibold text-slate-900 dark:text-slate-200 mb-1">
                      Voiceover / Spoken Line
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                      "{scene.voiceoverLine}"
                    </p>
                    {scene.onScreenText && (
                      <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-rose-600 dark:text-rose-400 font-medium">
                        On-Screen Text: {scene.onScreenText}
                      </div>
                    )}
                  </div>

                  <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                    <div className="font-semibold text-slate-900 dark:text-slate-200 mb-1">
                      Visual Action & Editing Instructions
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                      {scene.visualDescription}
                    </p>
                    <p className="mt-2 text-slate-500">
                      Edit Note: {scene.editingInstructions}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-2">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        AI Image Generation Prompt
                      </span>
                      <button
                        type="button"
                        onClick={() => copyText(scene.aiImagePrompt, `img_${idx}`)}
                        className="text-rose-600 dark:text-rose-400 hover:underline"
                      >
                        {copiedKey === `img_${idx}` ? 'Copied' : 'Copy Prompt'}
                      </button>
                    </div>
                    <div className="p-2.5 bg-slate-100/70 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded font-mono text-[11px] text-slate-600 dark:text-slate-400">
                      {scene.aiImagePrompt}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        AI Video Generation Prompt (Manual Handoff Ready)
                      </span>
                      <button
                        type="button"
                        onClick={() => copyText(scene.aiVideoPrompt, `vid_${idx}`)}
                        className="text-rose-600 dark:text-rose-400 hover:underline"
                      >
                        {copiedKey === `vid_${idx}` ? 'Copied' : 'Copy Prompt'}
                      </button>
                    </div>
                    <div className="p-2.5 bg-slate-100/70 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded font-mono text-[11px] text-slate-600 dark:text-slate-400">
                      {scene.aiVideoPrompt}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // TAB 4: THUMBNAIL STUDIO & VOICEOVER STUDIO (Modules 13 & 14)
  // -------------------------------------------------------------------------
  if (activeTab === 'thumbnail-studio') {
    return (
      <div>
        <ModuleBanner
          title="Thumbnail Studio & Voiceover Narration Lab"
          whatItDoes="Designs high-contrast thumbnail concepts with visual hierarchy rules (no misleading clickbait) and synthesizes studio voiceover previews via the Gemini Audio TTS adapter."
          whyItMatters="Clear focal hierarchy on thumbnails helps viewers immediately understand your video’s promise, while voiceover pacing notes guide natural delivery."
          howToUse="Compare the 3 thumbnail compositions below and test-render spoken audio narration from your active script."
          nextActionLabel="Open SEO Studio"
          onNextAction={() => onNavigate('seo-studio')}
        />

        <ScriptSelectorBar />

        {!activeScript ? (
          <div className="p-10 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
            <ImageIcon className="w-6 h-6 text-slate-400 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Generate a Script Package First
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Thumbnail concepts and voiceover delivery plans are automatically generated alongside your script.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Thumbnail Concepts Grid */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Module 13 · Thumbnail Concept Variations (A/B Testing Candidates)
                </h2>
                <span className="text-xs text-slate-500">
                  Note: Actual CTR improvements require live YouTube impression testing.
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {parsedThumbnails.map((tc: any, idx: number) => (
                  <div
                    key={idx}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col"
                  >
                    {/* 16:9 Visual Wireframe Composition Mockup */}
                    <div className="aspect-video bg-slate-950 p-5 flex flex-col justify-between relative border-b border-slate-800">
                      <div className="text-[11px] font-mono text-slate-400">
                        Concept 0{idx + 1} · {tc.conceptName}
                      </div>
                      <div className="my-auto">
                        <div className="inline-block px-3 py-1.5 bg-rose-600 text-white font-bold text-base tracking-tight rounded shadow-md">
                          {tc.thumbnailText || 'KEY VISUAL HOOK'}
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-300 line-clamp-1">
                        Subject: {tc.subjectPlacement}
                      </div>
                    </div>

                    <div className="p-5 space-y-3 text-xs flex-1 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div>
                          <span className="font-semibold text-slate-900 dark:text-slate-200">
                            Visual Hierarchy:{' '}
                          </span>
                          <span className="text-slate-600 dark:text-slate-400">
                            {tc.visualHierarchy}
                          </span>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-900 dark:text-slate-200">
                            Contrast Guidance:{' '}
                          </span>
                          <span className="text-slate-600 dark:text-slate-400">
                            {tc.contrastGuidance}
                          </span>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            Image Prompt
                          </span>
                          <button
                            type="button"
                            onClick={() => copyText(tc.imagePrompt, `thumb_${idx}`)}
                            className="text-rose-600 dark:text-rose-400 hover:underline"
                          >
                            {copiedKey === `thumb_${idx}` ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <p className="font-mono text-[11px] text-slate-500 line-clamp-3">
                          {tc.imagePrompt}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Module 14: Voiceover Studio */}
            <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <div className="text-xs text-slate-500">
                    Module 14 · Voiceover Studio (Gemini Audio TTS Adapter Connected)
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                    Narration Preparation, Pronunciation & Audio Export
                  </h2>
                </div>

                <div className="flex items-center gap-3">
                  <select
                    value={voiceName}
                    onChange={(e) => setVoiceName(e.target.value)}
                    className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg"
                  >
                    <option value="Kore">Voice: Kore (Clear Studio)</option>
                    <option value="Puck">Voice: Puck (Energetic)</option>
                    <option value="Charon">Voice: Charon (Deep Documentary)</option>
                    <option value="Aoede">Voice: Aoede (Warm Narrative)</option>
                  </select>

                  <button
                    type="button"
                    onClick={handleSynthesizeVoiceover}
                    disabled={ttsLoading}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {ttsLoading ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Synthesizing WAV...</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>Generate Voiceover Preview</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {audioDataUrl && (
                <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <audio controls src={audioDataUrl} className="w-full max-w-md h-10" />
                  <a
                    href={audioDataUrl}
                    download={`${activeScript.title.replace(/[^a-zA-Z0-9]/g, '_')}_voiceover.wav`}
                    className="px-4 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0 text-center"
                  >
                    Download WAV Audio
                  </a>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-200 mb-1">
                    Delivery & Emotion Direction
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                    {parsedVoiceover.deliveryDirection || 'Maintain conversational clarity with deliberate 0.5s pauses before key reveals.'}
                  </p>
                  {Array.isArray(parsedVoiceover.pronunciationNotes) &&
                    parsedVoiceover.pronunciationNotes.length > 0 && (
                      <div className="mt-3">
                        <div className="font-semibold text-slate-900 dark:text-slate-200 mb-1">
                          Pronunciation & Emphasis Notes
                        </div>
                        <ul className="space-y-1 text-slate-600 dark:text-slate-400">
                          {parsedVoiceover.pronunciationNotes.map((pn: string, i: number) => (
                            <li key={i}>• {pn}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                </div>

                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-200 mb-1">
                    Pacing-Marked Narration Script
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {parsedVoiceover.narrationScriptWithPauses || activeScript.scriptContent}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // TAB 5: SEO STUDIO (Module 15)
  // -------------------------------------------------------------------------
  return (
    <div>
      <ModuleBanner
        title="SEO Studio & Search-Intent Metadata"
        whatItDoes="Generates search-intent aligned video titles, structured descriptions, video chapters, relevant keywords, and hashtags without keyword stuffing."
        whyItMatters="Clear metadata helps YouTube Search and Suggested systems match your video with viewers actively looking for your topic."
        howToUse="Review the search-intent explanation below and copy your titles, chapters, and tags into YouTube Studio when uploading."
        nextActionLabel="Schedule in Content Calendar"
        onNextAction={() => onNavigate('content-calendar')}
      />

      <ScriptSelectorBar />

      {!activeScript ? (
        <div className="p-10 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
          <Search className="w-6 h-6 text-slate-400 mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            No SEO Package Generated Yet
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Generate a production script in Script Studio to automatically create search-intent titles, chapters, and metadata.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2">
                Search-Intent Video Title Variations
              </h3>
              <div className="space-y-2">
                {(parsedSeo.titles || [activeScript.title]).map((t: string, i: number) => (
                  <div
                    key={i}
                    className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-between gap-3"
                  >
                    <span className="font-medium text-slate-900 dark:text-slate-100">{t}</span>
                    <button
                      type="button"
                      onClick={() => copyText(t, `seo_title_${i}`)}
                      className="text-rose-600 dark:text-rose-400 hover:underline shrink-0"
                    >
                      {copiedKey === `seo_title_${i}` ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">
                Search-Intent Strategy Explanation
              </h3>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                {parsedSeo.searchIntentExplanation || 'Structured for viewer clarity without artificial keyword stuffing.'}
              </p>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">
                Keywords & Hashtags
              </h3>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                {(parsedSeo.keywords || []).join(' · ')}
              </p>
              <p className="mt-2 font-mono text-rose-600 dark:text-rose-400">
                {(parsedSeo.hashtags || []).join(' ')}
              </p>
            </div>
          </div>

          <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Description & Video Chapters
              </h3>
              <button
                type="button"
                onClick={() =>
                  copyText(
                    `${parsedSeo.description || ''}\n\nChapters:\n${(parsedSeo.chapters || []).join('\n')}`,
                    'seo_desc'
                  )
                }
                className="text-rose-600 dark:text-rose-400 hover:underline"
              >
                {copiedKey === 'seo_desc' ? 'Copied Description' : 'Copy Full Description'}
              </button>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg whitespace-pre-wrap text-slate-700 dark:text-slate-300 leading-relaxed">
              {parsedSeo.description}
              {Array.isArray(parsedSeo.chapters) && parsedSeo.chapters.length > 0 && (
                <>
                  {'\n\nChapters:\n'}
                  {parsedSeo.chapters.join('\n')}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
