export type NavSectionId =
  | 'overview'
  | 'my-channel'
  | 'channel-audit'
  | 'growth-coach'
  | 'niche-research'
  | 'audience-research'
  | 'trend-radar'
  | 'competitor-research'
  | 'content-ideas'
  | 'script-studio'
  | 'retention-coach'
  | 'visual-studio'
  | 'thumbnail-studio'
  | 'seo-studio'
  | 'content-calendar'
  | 'analytics-lab'
  | 'growth-reports'
  | 'ai-chat'
  | 'integrations'
  | 'settings'
  | 'admin-dashboard'
  | 'admin-users'
  | 'admin-invitations'
  | 'admin-usage';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: 'creator' | 'super_admin';
  status: 'active' | 'suspended' | 'invited';
  inviteCodeUsed: string;
  dailyAiLimit: number;
  monthlyAiLimit: number;
  preferences: string;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  workspaceId: string;
  ownerUid: string;
  channelId: string;
  workspaceName: string;
  mode: 'standard' | 'new_creator';
  createdAt: string;
  updatedAt: string;
}

export interface YouTubeConnection {
  connectionId: string;
  ownerUid: string;
  workspaceId: string;
  channelId: string;
  channelHandle: string;
  channelTitle: string;
  connectionMode: 'public_url' | 'oauth_connected' | 'new_creator';
  grantedScopes: string;
  connectionStatus: 'connected' | 'public_only' | 'disconnected' | 'revoked';
  updatedAt: string;
}

export interface ChannelProfile {
  workspaceId: string;
  ownerUid: string;
  channelName: string;
  channelHandle: string;
  channelId: string;
  country: string;
  niche: string;
  subNiches: string; // JSON array string
  language: string;
  format: string;
  audienceProfile: string;
  positioning: string;
  strengths: string; // JSON array string
  weaknesses: string; // JSON array string
  opportunities: string; // JSON array string
  recommendations: string; // JSON array string
  subscriberCount: number;
  totalViews: number;
  videoCount: number;
  confidence: 'high' | 'medium' | 'low' | 'new_creator_estimate';
  isConfirmed: boolean;
  lastAnalyzedAt: string;
  updatedAt: string;
}

export interface ChannelVideo {
  videoDocId: string;
  workspaceId: string;
  ownerUid: string;
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  format: 'long_form' | 'shorts' | 'live';
  topic: string;
  views: number;
  likes: number;
  comments: number;
  avgViewDurationSec: number;
  avgPercentageViewed: number;
  ctr: number;
  dataSource: 'youtube_public_api' | 'youtube_analytics_api' | 'manual_entry';
  createdAt: string;
}

export interface ResearchReport {
  reportId: string;
  workspaceId: string;
  ownerUid: string;
  reportType: 'niche' | 'audience' | 'trends' | 'competitors' | 'fact_check' | 'audit' | 'retention';
  queryTopic: string;
  summary: string;
  sources: string; // JSON array of { title, uri }
  findings: string; // JSON object of structured findings
  confidence: 'verified' | 'partially_verified' | 'estimate' | 'unverified' | 'conflicting_evidence';
  createdAt: string;
}

export interface ContentIdea {
  ideaId: string;
  workspaceId: string;
  ownerUid: string;
  title: string;
  description: string;
  category: string;
  format: 'long_form' | 'shorts' | 'series';
  evidence: string;
  competitionLevel: 'low' | 'medium' | 'high';
  originalAngle: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  risks: string;
  audienceRelevanceScore: number;
  researchEvidenceScore: number;
  originalityScore: number;
  channelFitScore: number;
  productionFeasibilityScore: number;
  opportunityScore: number;
  status: 'saved' | 'selected' | 'scripting' | 'filming' | 'published' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface ScriptDocument {
  scriptId: string;
  workspaceId: string;
  ownerUid: string;
  ideaId: string;
  title: string;
  language: string;
  format: 'long_form' | 'shorts';
  targetDuration: string;
  style: string;
  hooks: string; // JSON array
  scriptContent: string;
  storyStructure: string; // JSON array
  curiosityGaps: string; // JSON array
  ctaOptions: string; // JSON array
  scenes: string; // JSON array
  seoData: string; // JSON object
  thumbnailConcepts: string; // JSON array
  voiceoverNotes: string; // JSON object
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnalyticsSnapshot {
  snapshotId: string;
  workspaceId: string;
  ownerUid: string;
  dateRange: string;
  source: 'youtube_analytics_oauth' | 'youtube_public_data' | 'manual_creator_log';
  views: number;
  watchTimeHours: number;
  avgViewDurationSec: number;
  avgPercentageViewed: number;
  subscribersGained: number;
  likes: number;
  comments: number;
  shares: number;
  impressions: number;
  ctr: number;
  topGeographies: string;
  deviceBreakdown: string;
  retentionNotes: string;
  syncedAt: string;
}

export interface ContentProject {
  projectId: string;
  workspaceId: string;
  ownerUid: string;
  projectName: string;
  topic: string;
  format: 'long_form' | 'shorts' | 'series';
  status: 'draft' | 'researching' | 'scripting' | 'production' | 'ready_to_publish' | 'published';
  scheduledDate: string;
  slotType: 'analytics_backed_slot' | 'testing_slot';
  ideaId: string;
  scriptId: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface UsageRecord {
  recordId: string;
  uid: string;
  workspaceId: string;
  provider: 'gemini' | 'youtube_data' | 'youtube_analytics' | 'search_grounding' | 'image_gen' | 'voice_tts';
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  createdAt: string;
}

export interface BetaInvitation {
  inviteId: string;
  email: string;
  inviteCode: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  invitedBy: string;
  maxDailyAiRequests: number;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
}

export interface AuditLog {
  logId: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  resource: string;
  details: string;
  createdAt: string;
}
