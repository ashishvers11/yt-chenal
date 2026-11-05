import React, { useState } from 'react';
import { Search, ExternalLink, RefreshCw, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  ChannelProfile,
  ChannelVideo,
  ResearchReport,
  NavSectionId,
} from '../types';
import {
  db,
  doc,
  setDoc,
  OperationType,
  handleFirestoreError,
  makeSafeId,
  clampStr,
  recordAiUsage,
  apiFetch,
} from '../lib/firebase';
import { ModuleBanner } from './ModuleBanner';

interface ResearchModulesProps {
  activeTab: 'niche-research' | 'audience-research' | 'trend-radar' | 'competitor-research' | 'retention-coach';
  uid: string;
  workspaceId: string;
  channelProfile: ChannelProfile | null;
  videos: ChannelVideo[];
  reports: ResearchReport[];
  onNavigate: (tab: NavSectionId, topicPrefill?: string) => void;
}

const MODULE_META: Record<
  ResearchModulesProps['activeTab'],
  {
    reportType: ResearchReport['reportType'];
    title: string;
    whatItDoes: string;
    whyItMatters: string;
    howToUse: string;
    exampleOutput: string;
    placeholder: string;
    disclaimer: string;
  }
> = {
  'niche-research': {
    reportType: 'niche',
    title: 'Niche Finder & Positioning Intelligence',
    whatItDoes:
      'Maps your primary niche, sub-niche clusters, adjacent audience interests, and long-term positioning without forcing your channel into a rigid box.',
    whyItMatters:
      'Creators grow faster when topic clusters reinforce each other so returning viewers watch multiple uploads in a session.',
    howToUse:
      'Enter a niche or topic cluster below and run the Niche Researcher agent. Save promising topic clusters directly to the Content Opportunity Engine.',
    exampleOutput:
      'Primary Niche: Applied AI Workflows · Sub-niches: Local LLMs, Coding Automation, Creator Productivity.',
    placeholder: 'e.g., Applied AI & Developer Productivity for Solo Creators',
    disclaimer:
      'Niche clusters are strategic recommendations derived from public topic signals and your channel profile.',
  },
  'audience-research': {
    reportType: 'audience',
    title: 'Audience Research & Viewer Intent',
    whatItDoes:
      'Analyzes video topics, public viewer questions, and engagement signals to identify unsolved problems and viewer expectations.',
    whyItMatters:
      'Addressing specific, recurring viewer questions creates immediate relevance in the first 15 seconds of your video.',
    howToUse:
      'Enter a topic or viewer segment to uncover common questions, frustrations, and high-clarity video angles.',
    exampleOutput:
      'Viewer Problem: "How do I structure a 10-minute tutorial without losing beginners at minute 2?"',
    placeholder: 'e.g., Beginner creators struggling with audio quality and pacing',
    disclaimer:
      'Note: Inferred audience characteristics and interest groups are estimates based on topic and public comment signals, not verified personal identities.',
  },
  'trend-radar': {
    reportType: 'trends',
    title: 'Trend Radar & Time-Based Demand Signals',
    whatItDoes:
      'Uses live Google Search Grounding and public metadata to evaluate topic freshness, momentum, competition signals, and saturation.',
    whyItMatters:
      'Separates genuine emerging demand from over-saturated topics that peaked months ago.',
    howToUse:
      'Enter a topic, technology, or event to inspect time-based evidence, source links, and fresh angles.',
    exampleOutput:
      'Topic: Small Language Models on Laptop · Direction: Rising search interest with low beginner-friendly coverage.',
    placeholder: 'e.g., On-device AI agents, Regional Indian street food history, Indie game dev logs',
    disclaimer:
      'Evidence Rule: Topics are never labeled as trending without supporting time-based web or YouTube search evidence.',
  },
  'competitor-research': {
    reportType: 'competitors',
    title: 'Competitor Intelligence & Content Gap Finder',
    whatItDoes:
      'Studies public channels in your space, compares public video topics, title patterns, and upload cadence, and highlights underserved content gaps.',
    whyItMatters:
      'Instead of copying popular uploads, you can spot questions that similar channels left unanswered.',
    howToUse:
      'Enter a competitor channel handle, niche, or topic to compare public title patterns and find underserved angles.',
    exampleOutput:
      'Content Gap: Most channels cover advanced benchmarks, but very few show real $0 budget setups.',
    placeholder: 'e.g., Channels similar to @fireship or @veritasium in science & tech explainers',
    disclaimer:
      'Privacy Boundary: Analysis uses strictly public video metadata and search results. ASH Creator Studio never claims access to competitors’ private analytics.',
  },
  'retention-coach': {
    reportType: 'retention',
    title: 'Retention Coach & Fact Verification Studio',
    whatItDoes:
      'Evaluates opening hooks, story pacing, curiosity gaps, and verifies factual claims against grounded web sources before you record.',
    whyItMatters:
      'Eliminating slow intros and unverified claims protects both your average percentage viewed and your channel credibility.',
    howToUse:
      'Paste a draft outline, video title, or factual claims below and choose either Retention Pacing Analysis or Fact-Check Verification.',
    exampleOutput:
      'Pacing Alert: Deliver the visual proof in the first 8 seconds instead of spending 45 seconds on channel housekeeping.',
    placeholder: 'Paste a video concept, hook draft, or factual claims to analyze...',
    disclaimer:
      'When private audience retention curves are unavailable, recommendations are based on structural script pacing and available channel metrics.',
  },
};

export const ResearchModules: React.FC<ResearchModulesProps> = ({
  activeTab,
  uid,
  workspaceId,
  channelProfile,
  videos,
  reports,
  onNavigate,
}) => {
  const meta = MODULE_META[activeTab];
  const [queryInput, setQueryInput] = useState<string>(
    channelProfile?.niche ? `${channelProfile.niche}` : ''
  );
  const [subMode, setSubMode] = useState<'retention' | 'fact_check'>('retention');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const effectiveReportType: ResearchReport['reportType'] =
    activeTab === 'retention-coach' ? subMode : meta.reportType;

  const filteredReports = reports.filter((r) =>
    activeTab === 'retention-coach'
      ? r.reportType === 'retention' || r.reportType === 'fact_check'
      : r.reportType === meta.reportType
  );

  const handleRunResearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = queryInput.trim() || channelProfile?.niche || 'YouTube creator growth strategy';
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/v1/research/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportType: effectiveReportType,
          queryTopic: q,
          channelProfile,
          videos: videos.slice(0, 6),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Research request failed.');

      if (data.usage) {
        await recordAiUsage(uid, workspaceId, data.usage);
      }

      const reportId = makeSafeId('rep');
      const now = new Date().toISOString();
      const reportDoc: ResearchReport = {
        reportId,
        workspaceId,
        ownerUid: uid,
        reportType: effectiveReportType,
        queryTopic: clampStr(q, 300, 'Research Topic'),
        summary: clampStr(data.report?.summary, 5000, 'Research completed.'),
        sources: clampStr(JSON.stringify(data.report?.sources || []), 10000, '[]'),
        findings: clampStr(JSON.stringify(data.report?.findings || {}), 25000, '{}'),
        confidence: data.report?.confidence || 'estimate',
        createdAt: now,
      };

      try {
        await setDoc(doc(db, 'researchReports', reportId), reportDoc);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `researchReports/${reportId}`);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to run research agent.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <ModuleBanner
        title={meta.title}
        whatItDoes={meta.whatItDoes}
        whyItMatters={meta.whyItMatters}
        howToUse={meta.howToUse}
        exampleOutput={meta.exampleOutput}
        nextActionLabel="Send Findings to Content Ideas"
        onNextAction={() => onNavigate('content-ideas', queryInput)}
      />

      {/* Research Input Bar */}
      <form
        onSubmit={handleRunResearch}
        className="mb-8 p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <label className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Research Topic, Claim, or Niche Query
          </label>

          {activeTab === 'retention-coach' && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setSubMode('retention')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  subMode === 'retention'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Retention & Pacing Coach (Module 11)
              </button>
              <button
                type="button"
                onClick={() => setSubMode('fact_check')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  subMode === 'fact_check'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:bg-transparent dark:text-slate-400'
                }`}
              >
                Research & Fact Checker (Module 8)
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder={meta.placeholder}
            className="flex-1 px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {loading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Researching with Grounding...</span>
              </>
            ) : (
              <>
                <Search className="w-3.5 h-3.5" />
                <span>
                  {activeTab === 'retention-coach' && subMode === 'fact_check'
                    ? 'Verify Claims & Sources'
                    : 'Run Intelligence Agent'}
                </span>
              </>
            )}
          </button>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          {meta.disclaimer}
        </p>
      </form>

      {errorMsg && (
        <div className="mb-6 p-4 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Reports List */}
      {filteredReports.length === 0 ? (
        <div className="p-10 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            No {meta.title} Reports Generated Yet
          </h3>
          <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
            Enter a query above and click Run Intelligence Agent to generate an evidence-backed report with verified web sources and strategic recommendations.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredReports.map((report) => {
            let parsedFindings: any = {};
            let parsedSources: Array<{ title: string; uri: string }> = [];
            try {
              parsedFindings = JSON.parse(report.findings || '{}');
            } catch {
              parsedFindings = {};
            }
            try {
              parsedSources = JSON.parse(report.sources || '[]');
            } catch {
              parsedSources = [];
            }

            return (
              <article
                key={report.reportId}
                className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-5"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span>Query: {report.queryTopic}</span>
                      <span aria-hidden="true">·</span>
                      <span>Verification Status: {report.confidence.replace(/_/g, ' ')}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {new Date(report.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <h2 className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">
                      {report.queryTopic}
                    </h2>
                  </div>

                  <button
                    type="button"
                    onClick={() => onNavigate('content-ideas', report.queryTopic)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline whitespace-nowrap shrink-0"
                  >
                    <span>Generate Video Ideas From Report</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Executive Summary */}
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  {report.summary}
                </p>

                {/* Key Insights */}
                {Array.isArray(parsedFindings.keyInsights) && parsedFindings.keyInsights.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-200 mb-2">
                      Evidence-Backed Findings
                    </h3>
                    <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                      {parsedFindings.keyInsights.map((insight: string, idx: number) => (
                        <li key={idx} className="leading-relaxed">
                          • {insight}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Topic Clusters / Content Gaps Table */}
                {Array.isArray(parsedFindings.topicClustersOrGaps) &&
                  parsedFindings.topicClustersOrGaps.length > 0 && (
                    <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400">
                            <th className="py-2.5 px-4 font-semibold">Topic Cluster / Angle</th>
                            <th className="py-2.5 px-4 font-semibold">Demand Evidence</th>
                            <th className="py-2.5 px-4 font-semibold">Saturation</th>
                            <th className="py-2.5 px-4 font-semibold">Recommended Creator Angle</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {parsedFindings.topicClustersOrGaps.map((cluster: any, i: number) => (
                            <tr key={i} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                              <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                                {cluster.title}
                              </td>
                              <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">
                                {cluster.demandSignal}
                              </td>
                              <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">
                                {cluster.saturation}
                              </td>
                              <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">
                                {cluster.recommendedAngle}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                {/* Fact Check Claims Table */}
                {Array.isArray(parsedFindings.factCheckClaims) &&
                  parsedFindings.factCheckClaims.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-200 mb-2">
                        Claim-by-Claim Verification Matrix
                      </h3>
                      <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                        {parsedFindings.factCheckClaims.map((fc: any, i: number) => (
                          <div key={i} className="p-3.5 text-xs space-y-1">
                            <div className="flex items-center justify-between gap-4">
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                {fc.claim}
                              </span>
                              <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300 shrink-0">
                                {String(fc.status).toLowerCase().includes('verified') &&
                                !String(fc.status).toLowerCase().includes('unverified') ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                ) : (
                                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                                )}
                                <span>{fc.status}</span>
                              </span>
                            </div>
                            <p className="text-slate-600 dark:text-slate-400">{fc.evidenceNote}</p>
                            {fc.sourceUrl && (
                              <a
                                href={fc.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 hover:underline"
                              >
                                <span>Source Link</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Grounding Sources */}
                {parsedSources.length > 0 && (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-200 mb-2">
                      Verified Web Sources ({parsedSources.length})
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                      {parsedSources.map((src, i) => (
                        <a
                          key={i}
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 hover:underline truncate max-w-xs"
                        >
                          <span className="truncate">{src.title}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Uncertainty & Limitations */}
                {parsedFindings.limitationsAndUncertainty && (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      Limitations & Uncertainty:{' '}
                    </span>
                    {parsedFindings.limitationsAndUncertainty}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
