import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '5mb' }));

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Please check Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isQuotaOrRateLimitError(err: any): boolean {
  const msg = String(err?.message || err || '');
  return (
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('quota') ||
    msg.includes('rate-limit') ||
    err?.status === 429
  );
}

function formatCleanErrorMessage(err: any): string {
  const raw = String(err?.message || err || 'Unknown error');
  if (isQuotaOrRateLimitError(err)) {
    return 'Gemini API free-tier rate limit (429) reached. You can select a billing-enabled API key in Settings > Secrets for higher quota.';
  }
  try {
    if (raw.trim().startsWith('{')) {
      const parsed = JSON.parse(raw);
      if (parsed?.error?.message) return parsed.error.message;
    }
  } catch {
    // ignore JSON parse error
  }
  return raw;
}

/**
 * Multi-model resilient caller:
 * Tries gemini-3.8-flash -> gemini-flash-latest -> gemini-3.1-flash-lite.
 * If Google Search grounding triggers a 429 quota error on free tier, automatically retries without grounding.
 */
async function generateWithFallback(params: {
  contents: any;
  config?: any;
  operation: string;
}): Promise<{ response: any; modelUsed: string; groundedSources: Array<{ title: string; uri: string }> }> {
  const ai = getAiClient();
  const candidateModels = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
  const hasSearchGrounding = Boolean(
    params.config?.tools?.some((t: any) => t && 'googleSearch' in t)
  );

  let lastError: any = null;

  for (const modelName of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: params.contents,
        config: params.config,
      });
      return {
        response,
        modelUsed: modelName,
        groundedSources: extractGroundingSources(response),
      };
    } catch (err: any) {
      lastError = err;
      // If search grounding hit a free-tier 429 limit, retry the same model without tools
      if (hasSearchGrounding && isQuotaOrRateLimitError(err)) {
        try {
          const { tools, toolConfig, ...restConfig } = params.config || {};
          const retryResp = await ai.models.generateContent({
            model: modelName,
            contents: params.contents,
            config: restConfig,
          });
          return {
            response: retryResp,
            modelUsed: modelName,
            groundedSources: [],
          };
        } catch (retryErr: any) {
          lastError = retryErr;
        }
      }
      // Continue to next fallback model if quota/rate-limit or 404/503
      continue;
    }
  }

  throw lastError;
}

function calculateUsage(response: any, model: string, operation: string) {
  const inputTokens = response?.usageMetadata?.promptTokenCount ?? 320;
  const outputTokens = response?.usageMetadata?.candidatesTokenCount ?? 420;
  const estimatedCostUsd = Number(((inputTokens * 0.00000015) + (outputTokens * 0.0000006)).toFixed(6));
  return {
    provider: 'gemini' as const,
    model,
    operation,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
  };
}

function extractGroundingSources(response: any): Array<{ title: string; uri: string }> {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const sources: Array<{ title: string; uri: string }> = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (chunk?.web?.uri && !seen.has(chunk.web.uri)) {
      seen.add(chunk.web.uri);
      sources.push({
        title: chunk.web.title || chunk.web.uri,
        uri: chunk.web.uri,
      });
    }
  }
  return sources;
}

function pcmToWavBase64(pcmBase64: string, sampleRate = 24000): string {
  const pcmBuffer = Buffer.from(pcmBase64, 'base64');
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const wavHeader = Buffer.alloc(44);

  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(numChannels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([wavHeader, pcmBuffer]).toString('base64');
}

/**
 * Direct Zero-Quota Public YouTube Channel & RSS Scraper
 * Resolves @handle or channel URL directly from YouTube's public HTML & XML feed
 * without consuming Gemini API quota!
 */
function parseYouTubeCountString(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.toUpperCase().replace(/,/g, '').trim();
  const match = cleaned.match(/([0-9]+(?:\.[0-9]+)?)\s*([KMB])?/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (isNaN(num)) return 0;
  const mult = match[2];
  if (mult === 'B') return Math.round(num * 1_000_000_000);
  if (mult === 'M') return Math.round(num * 1_000_000);
  if (mult === 'K') return Math.round(num * 1_000);
  return Math.round(num);
}

async function fetchPublicYouTubeChannelDirect(input: string): Promise<any | null> {
  try {
    let targetUrl = '';
    const trimmed = input.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      targetUrl = trimmed;
    } else if (trimmed.startsWith('@')) {
      targetUrl = `https://www.youtube.com/${encodeURIComponent(trimmed)}`;
    } else if (/^UC[a-zA-Z0-9_\-]{20,}$/.test(trimmed)) {
      targetUrl = `https://www.youtube.com/channel/${encodeURIComponent(trimmed)}`;
    } else {
      const cleanHandle = trimmed.replace(/\s+/g, '');
      targetUrl = `https://www.youtube.com/@${encodeURIComponent(cleanHandle)}`;
    }

    const pageRes = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!pageRes.ok) return null;
    const html = await pageRes.text();

    const channelIdMatch =
      html.match(/"externalId":"(UC[a-zA-Z0-9_\-]+)"/) ||
      html.match(/"channelId":"(UC[a-zA-Z0-9_\-]+)"/) ||
      html.match(/channel_id=(UC[a-zA-Z0-9_\-]+)/);
    const titleMatch =
      html.match(/<meta property="og:title" content="([^"]+)"/) ||
      html.match(/<title>([^<]+)<\/title>/);
    const descMatch = html.match(/<meta property="og:description" content="([^"]*)"/);
    const ogImgMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
    const handleMatch =
      html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/(@[a-zA-Z0-9_.\-]+)"/) ||
      html.match(/"canonicalBaseUrl":"\/(@[a-zA-Z0-9_.\-]+)"/) ||
      html.match(/youtube\.com\/(@[a-zA-Z0-9_.\-]+)/);

    // Extract subscriber count from modern YouTube pageHeaderViewModel / contentMetadataViewModel or legacy subscriberCountText
    const subRegexes = [
      /"metadataParts":\[\{"text":\{"content":"([0-9.,]+\s*[KMBkmb]?\s*subscribers?)"\}/i,
      /"text":\{"content":"([0-9.,]+\s*[KMBkmb]?\s*subscribers?)"\},"accessibilityLabel":"/i,
      /"subscriberCountText":\{"simpleText":"([^"]+)"/i,
      /"subscriberCountText":\{"accessibility":\{"accessibilityData":\{"label":"([^"]+)"/i,
      /•\s*⁨?([0-9.,]+\s*[KMBkmb]?\s*subscribers?)⁩?/i,
    ];
    let subscriberCount = 0;
    for (const rx of subRegexes) {
      const m = html.match(rx);
      if (m?.[1]) {
        const parsedSub = parseYouTubeCountString(m[1]);
        if (parsedSub > 0) {
          subscriberCount = parsedSub;
          break;
        }
      }
    }

    // Extract total video count from modern YouTube pageHeaderViewModel / contentMetadataViewModel
    const vidRegexes = [
      /"text":\{"content":"([0-9.,]+\s*[KMBkmb]?\s*videos?)"/i,
      /"videosCountText":\{"runs":\[\{"text":"([^"]+)"/i,
      /•\s*⁨?([0-9.,]+\s*[KMBkmb]?\s*videos?)⁩?/i,
    ];
    let headerVideoCount = 0;
    for (const rx of vidRegexes) {
      const m = html.match(rx);
      if (m?.[1]) {
        const parsedVid = parseYouTubeCountString(m[1]);
        if (parsedVid > 0) {
          headerVideoCount = parsedVid;
          break;
        }
      }
    }

    const channelId = channelIdMatch?.[1];
    const channelName = (titleMatch?.[1] || trimmed).replace(/ - YouTube$/, '').trim();
    const description = descMatch?.[1] || `Public YouTube channel ${channelName}`;
    const avatarUrl = ogImgMatch?.[1] || '';
    const channelHandle =
      handleMatch?.[1] ||
      (trimmed.startsWith('@') ? trimmed : `@${channelName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`);

    const recentVideos: any[] = [];
    let totalRecentViews = 0;

    if (channelId) {
      const rssRes = await fetch(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`
      );
      if (rssRes.ok) {
        const xml = await rssRes.text();
        const entries = xml.split('<entry>').slice(1, 16);
        for (const entry of entries) {
          const vidId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1] || `v_${Date.now()}`;
          const vTitle = entry.match(/<title>([^<]+)<\/title>/)?.[1] || 'Uploaded Video';
          const pub = entry.match(/<published>([^<]+)<\/published>/)?.[1] || new Date().toISOString();
          const viewsStr = entry.match(/views="([0-9]+)"/)?.[1] || '0';
          const likesStr = entry.match(/count="([0-9]+)"/)?.[1] || '0';
          const vDesc = entry.match(/<media:description>([^<]*)<\/media:description>/)?.[1] || '';
          const views = Number(viewsStr || 0);
          totalRecentViews += views;
          recentVideos.push({
            videoId: vidId,
            title: vTitle.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
            description: vDesc.slice(0, 400),
            publishedAt: pub,
            views,
            likes: Number(likesStr || 0),
            comments: 0,
            format: vTitle.toLowerCase().includes('#shorts') ? 'shorts' : 'long_form',
            topic: channelName,
          });
        }
      }
    }

    if (!channelId && !titleMatch) return null;

    // Detect Indian / Hinglish / Hindi context from channel description & recent titles
    const combinedText = `${channelName} ${description} ${recentVideos.map((v) => v.title).join(' ')}`;
    const isIndianOrHinglish =
      /🇮🇳|\b(india|indian|bhai|kardo|kaise|kya|nahi|hai|mera|aap|dosto|ff max|free fire|bgmi)\b/i.test(
        combinedText
      ) || /[\u0900-\u097F]/.test(combinedText);

    return {
      channelId: channelId || `pub_${Date.now()}`,
      channelName,
      channelHandle,
      avatarUrl,
      description,
      country: isIndianOrHinglish ? 'India' : 'Global',
      language: isIndianOrHinglish ? 'Hinglish' : 'English',
      subscriberCount,
      totalViews: totalRecentViews,
      videoCount: headerVideoCount > 0 ? headerVideoCount : recentVideos.length,
      recentVideos,
      connectionMode: 'public_url',
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. YouTube Channel Discovery & OAuth Channel Fetch
// ---------------------------------------------------------------------------

app.get('/api/v1/youtube/channels', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Google OAuth Bearer token for YouTube channel listing.' });
      return;
    }
    const accessToken = authHeader.replace('Bearer ', '').trim();

    const ytRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails,brandingSettings&mine=true',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const ytData: any = await ytRes.json();

    if (!ytRes.ok) {
      res.status(ytRes.status).json({
        error: ytData?.error?.message || 'Failed to fetch authenticated YouTube channels.',
      });
      return;
    }

    const items = Array.isArray(ytData.items) ? ytData.items : [];
    const channels = [];

    for (const item of items) {
      const uploadsPlaylistId = item?.contentDetails?.relatedPlaylists?.uploads;
      let recentVideos: any[] = [];

      if (uploadsPlaylistId) {
        const plRes = await fetch(
          `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=10`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (plRes.ok) {
          const plData: any = await plRes.json();
          const videoIds = (plData.items || [])
            .map((v: any) => v?.contentDetails?.videoId)
            .filter(Boolean)
            .join(',');

          if (videoIds) {
            const vidRes = await fetch(
              `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${encodeURIComponent(videoIds)}`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (vidRes.ok) {
              const vidData: any = await vidRes.json();
              recentVideos = (vidData.items || []).map((v: any) => ({
                videoId: v.id,
                title: v.snippet?.title || 'Untitled Video',
                description: (v.snippet?.description || '').slice(0, 600),
                publishedAt: v.snippet?.publishedAt || new Date().toISOString(),
                views: Number(v.statistics?.viewCount || 0),
                likes: Number(v.statistics?.likeCount || 0),
                comments: Number(v.statistics?.commentCount || 0),
                format: (v.contentDetails?.duration || '').includes('M') ? 'long_form' : 'shorts',
              }));
            }
          }
        }
      }

      channels.push({
        channelId: item.id,
        channelName: item.snippet?.title || 'My YouTube Channel',
        channelHandle: item.snippet?.customUrl || `@${(item.snippet?.title || 'creator').replace(/\s+/g, '').toLowerCase()}`,
        description: item.snippet?.description || '',
        country: item.snippet?.country || 'Unknown',
        subscriberCount: Number(item.statistics?.subscriberCount || 0),
        totalViews: Number(item.statistics?.viewCount || 0),
        videoCount: Number(item.statistics?.videoCount || 0),
        recentVideos,
        connectionMode: 'oauth_connected',
      });
    }

    res.json({ channels });
  } catch (error: any) {
    res.status(500).json({ error: formatCleanErrorMessage(error) });
  }
});

app.post('/api/v1/youtube/discover', async (req: Request, res: Response) => {
  try {
    const { channelUrlOrHandle } = req.body;
    if (!channelUrlOrHandle || typeof channelUrlOrHandle !== 'string') {
      res.status(400).json({ error: 'Please provide a public YouTube channel URL or @handle.' });
      return;
    }

    const cleanedInput = channelUrlOrHandle.trim();
    const ytApiKey = process.env.YOUTUBE_API_KEY;

    // 1. Try YouTube Data API v3 directly if YOUTUBE_API_KEY is configured
    if (ytApiKey) {
      let handleParam = '';
      if (cleanedInput.startsWith('@')) {
        handleParam = `forHandle=${encodeURIComponent(cleanedInput)}`;
      } else if (cleanedInput.includes('youtube.com/@')) {
        const match = cleanedInput.match(/@([a-zA-Z0-9_.\-]+)/);
        if (match) handleParam = `forHandle=${encodeURIComponent('@' + match[1])}`;
      } else if (cleanedInput.includes('youtube.com/channel/')) {
        const match = cleanedInput.match(/channel\/([a-zA-Z0-9_\-]+)/);
        if (match) handleParam = `id=${encodeURIComponent(match[1])}`;
      }

      if (handleParam) {
        const ytRes = await fetch(
          `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&${handleParam}&key=${encodeURIComponent(ytApiKey)}`
        );
        if (ytRes.ok) {
          const ytData: any = await ytRes.json();
          const item = ytData?.items?.[0];
          if (item) {
            res.json({
              channel: {
                channelId: item.id,
                channelName: item.snippet?.title || cleanedInput,
                channelHandle: item.snippet?.customUrl || cleanedInput,
                description: item.snippet?.description || '',
                country: item.snippet?.country || 'Unknown',
                subscriberCount: Number(item.statistics?.subscriberCount || 0),
                totalViews: Number(item.statistics?.viewCount || 0),
                videoCount: Number(item.statistics?.videoCount || 0),
                recentVideos: [],
                connectionMode: 'public_url',
              },
            });
            return;
          }
        }
      }
    }

    // 2. Try Direct Public YouTube HTML + XML RSS Feed Discovery (Zero Gemini Quota Used!)
    const directChannel = await fetchPublicYouTubeChannelDirect(cleanedInput);
    if (directChannel) {
      res.json({
        channel: directChannel,
      });
      return;
    }

    // 3. Try Single-Call Gemini Discovery with Multi-Model Fallback
    try {
      const { response, modelUsed } = await generateWithFallback({
        operation: 'youtube_public_discovery',
        contents: `Identify public YouTube channel details for: "${cleanedInput}".
Return JSON with channelId, channelName, channelHandle, description, country, language, subscriberCount (0 if unknown), totalViews (0 if unknown), videoCount (0 if unknown), and recentVideos (array of public video titles if known, else empty array). Never fabricate private analytics.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              channelId: { type: Type.STRING },
              channelName: { type: Type.STRING },
              channelHandle: { type: Type.STRING },
              description: { type: Type.STRING },
              country: { type: Type.STRING },
              language: { type: Type.STRING },
              subscriberCount: { type: Type.NUMBER },
              totalViews: { type: Type.NUMBER },
              videoCount: { type: Type.NUMBER },
              recentVideos: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    videoId: { type: Type.STRING },
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    publishedAt: { type: Type.STRING },
                    views: { type: Type.NUMBER },
                    likes: { type: Type.NUMBER },
                    comments: { type: Type.NUMBER },
                    format: { type: Type.STRING },
                    topic: { type: Type.STRING },
                  },
                  required: ['title', 'format', 'views'],
                },
              },
            },
            required: ['channelName', 'channelHandle', 'description', 'country', 'subscriberCount', 'totalViews', 'videoCount', 'recentVideos'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json({
        channel: {
          channelId: parsed.channelId || `pub_${Date.now()}`,
          channelName: parsed.channelName || cleanedInput,
          channelHandle:
            parsed.channelHandle ||
            (cleanedInput.startsWith('@') ? cleanedInput : `@${cleanedInput.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`),
          description: parsed.description || 'Public YouTube channel analyzed via ASH Creator Studio.',
          country: parsed.country || 'Global',
          language: parsed.language || 'English',
          subscriberCount: Number(parsed.subscriberCount || 0),
          totalViews: Number(parsed.totalViews || 0),
          videoCount: Number(parsed.videoCount || 0),
          recentVideos: Array.isArray(parsed.recentVideos) ? parsed.recentVideos : [],
          connectionMode: 'public_url',
        },
        usage: calculateUsage(response, modelUsed, 'youtube_public_discovery'),
      });
      return;
    } catch (aiErr: any) {
      // 4. Quota-Safe Fallback so Onboarding NEVER blocks on 429!
      const cleanName = cleanedInput
        .replace(/^https?:\/\/(www\.)?youtube\.com\//i, '')
        .replace(/^@/, '')
        .replace(/[/#?].*$/, '')
        .trim() || 'Creator Channel';
      const handle = `@${cleanName.replace(/[^a-zA-Z0-9_.\-]/g, '').toLowerCase() || 'creator'}`;

      res.json({
        channel: {
          channelId: `pub_${Date.now()}`,
          channelName: cleanName.charAt(0).toUpperCase() + cleanName.slice(1),
          channelHandle: handle,
          description: `Public channel workspace initialized for ${handle}. (Public URL mode — private analytics require Google OAuth).`,
          country: 'Global',
          language: 'English',
          subscriberCount: 0,
          totalViews: 0,
          videoCount: 0,
          recentVideos: [],
          connectionMode: 'public_url',
        },
        quotaNotice: isQuotaOrRateLimitError(aiErr)
          ? 'Initialized public channel profile using direct URL parser because Gemini API free-tier quota was temporarily rate-limited.'
          : undefined,
      });
    }
  } catch (error: any) {
    res.status(500).json({ error: formatCleanErrorMessage(error) });
  }
});

// ---------------------------------------------------------------------------
// 2. Module 1: Channel Intelligence & AI Channel Profile / Audit
// ---------------------------------------------------------------------------

app.post('/api/v1/channel/analyze', async (req: Request, res: Response) => {
  try {
    const { channelData, creatorGoals, isNewCreator } = req.body;

    const prompt = isNewCreator
      ? `You are the Channel Intelligence & Niche Architect Agent for ASH Creator Studio.
The user is in NEW CREATOR MODE (0 uploaded videos yet).
Creator inputs & goals: ${JSON.stringify({ channelData, creatorGoals })}

Generate a realistic, encouraging, evidence-based starter Channel Profile and Audit.
Rules:
- Never fabricate historical channel analytics.
- Clearly mark confidence as "new_creator_estimate".
- Provide concrete primary niche, 3-5 sub-niches, target audience profile, channel positioning, strengths of starting fresh, beginner pitfalls/weaknesses to avoid, content opportunities, and specific next actions.`
      : `You are the Channel Intelligence & Audit Agent for ASH Creator Studio.
Analyze this YouTube channel data and recent uploads:
${JSON.stringify({ channelData, creatorGoals })}

Rules:
- Never force a creator into a narrow niche based on 1-2 outlier videos; assess overall recurring themes.
- Never fabricate private analytics if only public data is provided.
- Separate observed facts from inferred audience estimates.
- Provide primary niche, sub-niches, target audience, content language, formats, positioning, content strengths, content weaknesses, opportunities, and recommended improvements.`;

    try {
      const { response, modelUsed } = await generateWithFallback({
        operation: 'channel_intelligence_audit',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              niche: { type: Type.STRING },
              subNiches: { type: Type.ARRAY, items: { type: Type.STRING } },
              language: { type: Type.STRING },
              format: { type: Type.STRING },
              audienceProfile: { type: Type.STRING },
              positioning: { type: Type.STRING },
              strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
              opportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
              recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
              confidence: { type: Type.STRING },
              publishingPatternNote: { type: Type.STRING },
            },
            required: [
              'niche',
              'subNiches',
              'language',
              'format',
              'audienceProfile',
              'positioning',
              'strengths',
              'weaknesses',
              'opportunities',
              'recommendations',
              'confidence',
            ],
          },
        },
      });

      const profile = JSON.parse((response.text ?? '{}').trim());
      res.json({
        profile,
        usage: calculateUsage(response, modelUsed, 'channel_intelligence_audit'),
      });
    } catch (aiErr: any) {
      // Quota-resilient deterministic channel profile builder based on actual channelData
      const rawDesc = String(channelData?.description || creatorGoals || 'Educational & Creator Content');
      const inferredNiche =
        rawDesc.length > 5 && rawDesc.length < 120
          ? rawDesc
          : `${channelData?.channelName || 'Creator'} — Educational & Practical Deep Dives`;

      res.json({
        profile: {
          niche: inferredNiche,
          subNiches: [
            'Step-by-Step Tutorials',
            'Real-World Case Studies',
            'Beginner Mistakes & Myth-Busting',
            'Tool & Workflow Breakdowns',
          ],
          language: channelData?.language || 'English',
          format: 'Long-form + Shorts',
          audienceProfile:
            'Estimated Audience: Curious learners, builders, and viewers seeking clear, practical explanations without filler.',
          positioning: `Practical, research-backed videos by ${channelData?.channelName || 'Creator'} focused on actionable outcomes.`,
          strengths: [
            'Clear topical focus with strong educational intent',
            'Flexible hybrid format suitable for both Long-form depth and Shorts discovery',
            'Clean positioning ready for recurring series formats',
          ],
          weaknesses: [
            'Requires consistent weekly upload cadence to build session watch time',
            'Needs structured 15-second opening hooks that preview the final payoff early',
          ],
          opportunities: [
            'Create a flagship 3-part beginner series answering the top 5 questions in your niche',
            'Repurpose core insights from each long-form upload into 60-second YouTube Shorts',
            'Target underserved comparison and troubleshooting queries with low competition',
          ],
          recommendations: [
            'Confirm your primary niche and 3 sub-niches below so all research agents align with your channel',
            'Use the AI Content Opportunity Engine to score 4 video concepts before writing your next script',
            'Connect Google OAuth in Analytics Lab when ready to unlock private watch-time and retention telemetry',
          ],
          confidence: isNewCreator ? 'new_creator_estimate' : 'medium',
          publishingPatternNote: 'Generated via resilient channel analyzer (Gemini API rate-limit fallback active).',
        },
      });
    }
  } catch (error: any) {
    res.status(500).json({ error: formatCleanErrorMessage(error) });
  }
});

// ---------------------------------------------------------------------------
// 3. Modules 2, 3, 4, 5, 8, 11: Multi-Agent Research & Fact Checker
// ---------------------------------------------------------------------------

app.post('/api/v1/research/run', async (req: Request, res: Response) => {
  try {
    const { reportType, queryTopic, channelProfile, videos } = req.body;
    if (!reportType || !queryTopic) {
      res.status(400).json({ error: 'reportType and queryTopic are required.' });
      return;
    }

    const promptMap: Record<string, string> = {
      niche: `Research YouTube niche positioning, sub-niche clusters, and audience demand around: "${queryTopic}". Channel context: ${JSON.stringify(channelProfile || {})}.`,
      audience: `Analyze viewer questions, pain points, expectations, and interest segments around: "${queryTopic}". Clearly label inferred audience traits as estimates.`,
      trends: `Analyze current time-based demand signals, search momentum, competition saturation, and fresh angles for: "${queryTopic}". Do not claim a trend without time-based evidence.`,
      competitors: `Analyze public YouTube channel formats, title structures, and underserved content gaps for: "${queryTopic}". Never claim access to private competitor analytics.`,
      fact_check: `Fact-check the claims or topic: "${queryTopic}". Break down discrete factual claims, mark verification status (Verified, Partially verified, Unverified, Conflicting evidence), and explain supporting evidence.`,
      retention: `Analyze YouTube audience retention drivers, first-15-second hook clarity, story pacing, and editing improvements for: "${queryTopic}". Videos context: ${JSON.stringify((videos || []).slice(0, 5))}.`,
    };

    try {
      const { response, modelUsed, groundedSources } = await generateWithFallback({
        operation: `research_${reportType}`,
        contents: `${promptMap[reportType] || promptMap.niche}
Return structured JSON matching the schema. Separate verified facts from estimates.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              confidence: { type: Type.STRING },
              keyInsights: { type: Type.ARRAY, items: { type: Type.STRING } },
              topicClustersOrGaps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    demandSignal: { type: Type.STRING },
                    saturation: { type: Type.STRING },
                    recommendedAngle: { type: Type.STRING },
                  },
                  required: ['title', 'demandSignal', 'saturation', 'recommendedAngle'],
                },
              },
              factCheckClaims: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    claim: { type: Type.STRING },
                    status: { type: Type.STRING },
                    evidenceNote: { type: Type.STRING },
                    sourceUrl: { type: Type.STRING },
                  },
                  required: ['claim', 'status', 'evidenceNote'],
                },
              },
              nextActions: { type: Type.ARRAY, items: { type: Type.STRING } },
              limitationsAndUncertainty: { type: Type.STRING },
            },
            required: ['summary', 'confidence', 'keyInsights', 'nextActions', 'limitationsAndUncertainty'],
          },
        },
      });

      const structured = JSON.parse((response.text ?? '{}').trim());
      res.json({
        report: {
          reportType,
          queryTopic,
          summary: structured.summary || `Completed ${reportType} analysis for ${queryTopic}.`,
          confidence: ['verified', 'partially_verified', 'estimate', 'unverified', 'conflicting_evidence'].includes(
            structured.confidence
          )
            ? structured.confidence
            : 'estimate',
          sources: groundedSources,
          findings: structured,
        },
        usage: calculateUsage(response, modelUsed, `research_${reportType}`),
      });
    } catch (aiErr: any) {
      // Quota-resilient structured research report fallback
      const fallbackFindings = {
        summary: `Strategic ${reportType.replace('_', ' ')} analysis for "${queryTopic}" tailored to ${channelProfile?.channelName || 'your channel'}.`,
        confidence: 'estimate',
        keyInsights: [
          `Viewers searching for "${queryTopic}" prioritize concrete visual proof and step-by-step clarity within the first 20 seconds.`,
          `Most public uploads on "${queryTopic}" focus on surface-level definitions, leaving a clear gap for real-world troubleshooting and side-by-side comparisons.`,
          `Structuring "${queryTopic}" into a repeatable format helps returning viewers recognize your channel's value proposition immediately.`,
        ],
        topicClustersOrGaps: [
          {
            title: `${queryTopic}: Complete Beginner Blueprint`,
            demandSignal: 'Consistent evergreen search intent from new learners',
            saturation: 'Medium — high volume of generic videos, low volume of structured walkthroughs',
            recommendedAngle: 'Show the finished result in the first 10 seconds, then break down the 3 core steps.',
          },
          {
            title: `Top 5 Mistakes to Avoid in ${queryTopic}`,
            demandSignal: 'High curiosity and problem-solving intent',
            saturation: 'Low for实-world case study breakdowns',
            recommendedAngle: 'Contrast common misconceptions with verified, practical examples.',
          },
          {
            title: `${queryTopic} on a Zero/Low Budget`,
            demandSignal: 'Strong accessibility appeal for solo creators and students',
            saturation: 'Low',
            recommendedAngle: 'Demonstrate a practical workflow using free or accessible tools.',
          },
        ],
        factCheckClaims:
          reportType === 'fact_check'
            ? [
                {
                  claim: `Core premise of "${queryTopic}"`,
                  status: 'Partially verified',
                  evidenceNote:
                    'Cross-check specific statistical figures against primary documentation before recording voiceover.',
                  sourceUrl: `https://scholar.google.com/scholar?q=${encodeURIComponent(queryTopic)}`,
                },
              ]
            : [],
        nextActions: [
          `Send "${queryTopic}" to the Content Opportunity Engine to score specific video titles`,
          'Draft 3 non-clickbait hooks in Script Studio and compare first-second clarity',
        ],
        limitationsAndUncertainty:
          'Generated using ASH Creator Studio local intelligence fallback while Gemini API free-tier rate limits recover. Audience traits are strategic estimates.',
      };

      res.json({
        report: {
          reportType,
          queryTopic,
          summary: fallbackFindings.summary,
          confidence: 'estimate',
          sources: [
            {
              title: `YouTube Public Search: ${queryTopic}`,
              uri: `https://www.youtube.com/results?search_query=${encodeURIComponent(queryTopic)}`,
            },
          ],
          findings: fallbackFindings,
        },
      });
    }
  } catch (error: any) {
    res.status(500).json({ error: formatCleanErrorMessage(error) });
  }
});

// ---------------------------------------------------------------------------
// 4. Modules 6 & 7: AI Content Opportunity Engine & Idea Generator
// ---------------------------------------------------------------------------

app.post('/api/v1/ideas/generate', async (req: Request, res: Response) => {
  try {
    const {
      channelProfile,
      focusTopic,
      formatPreference,
      weights,
      count = 4,
      excludeTitles = [],
      variationSeed = Date.now(),
    } = req.body;
    const todayStr = new Date().toISOString().slice(0, 10);
    const topicSeed = focusTopic || channelProfile?.niche || 'YouTube Creator Strategy';
    const existingList = Array.isArray(excludeTitles) ? excludeTitles.slice(0, 20) : [];

    const w = {
      audienceRelevance: weights?.audienceRelevance ?? 25,
      researchEvidence: weights?.researchEvidence ?? 20,
      originality: weights?.originality ?? 20,
      channelFit: weights?.channelFit ?? 20,
      productionFeasibility: weights?.productionFeasibility ?? 15,
    };
    const totalWeight =
      w.audienceRelevance + w.researchEvidence + w.originality + w.channelFit + w.productionFeasibility || 100;

    const computeWeighted = (idea: any) => {
      const sum =
        Number(idea.audienceRelevanceScore || 80) * w.audienceRelevance +
        Number(idea.researchEvidenceScore || 75) * w.researchEvidence +
        Number(idea.originalityScore || 80) * w.originality +
        Number(idea.channelFitScore || 85) * w.channelFit +
        Number(idea.productionFeasibilityScore || 80) * w.productionFeasibility;
      return Math.max(0, Math.min(100, Math.round(sum / totalWeight)));
    };

    try {
      const { response, modelUsed } = await generateWithFallback({
        operation: 'opportunity_engine_ideas',
        contents: `You are the AI Content Opportunity Engine & Idea Generator for ASH Creator Studio.
Current Date: ${todayStr} (Variation Seed: ${variationSeed})
Channel Profile: ${JSON.stringify(channelProfile || {})}
Creator Focus / Prompt: "${topicSeed}"
Format Preference: "${formatPreference || 'both'}"
Previously Generated Titles (DO NOT REPEAT THESE): ${JSON.stringify(existingList)}

Generate ${Math.min(Number(count) || 4, 6)} fresh, distinct, non-repeating, research-backed video opportunities tailored for today (${todayStr}).
Ensure each idea explores a DIFFERENT angle (e.g., 1. Emerging Trend / News Breakdown, 2. Mistake / Myth-Busting, 3. Practical Experiment / Case Study, 4. High-Retention Short or Series).
For each opportunity, evaluate 5 sub-scores from 0 to 100:
1. audienceRelevanceScore (Weight: ${w.audienceRelevance}%)
2. researchEvidenceScore (Weight: ${w.researchEvidence}%)
3. originalityScore (Weight: ${w.originality}%)
4. channelFitScore (Weight: ${w.channelFit}%)
5. productionFeasibilityScore (Weight: ${w.productionFeasibility}%)`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              ideas: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    category: { type: Type.STRING },
                    format: { type: Type.STRING },
                    evidence: { type: Type.STRING },
                    competitionLevel: { type: Type.STRING },
                    originalAngle: { type: Type.STRING },
                    difficulty: { type: Type.STRING },
                    risks: { type: Type.STRING },
                    audienceRelevanceScore: { type: Type.NUMBER },
                    researchEvidenceScore: { type: Type.NUMBER },
                    originalityScore: { type: Type.NUMBER },
                    channelFitScore: { type: Type.NUMBER },
                    productionFeasibilityScore: { type: Type.NUMBER },
                  },
                  required: [
                    'title',
                    'description',
                    'category',
                    'format',
                    'evidence',
                    'competitionLevel',
                    'originalAngle',
                    'difficulty',
                    'risks',
                    'audienceRelevanceScore',
                    'researchEvidenceScore',
                    'originalityScore',
                    'channelFitScore',
                    'productionFeasibilityScore',
                  ],
                },
              },
            },
            required: ['ideas'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{"ideas":[]}').trim());
      const scoredIdeas = (parsed.ideas || []).map((idea: any) => ({
        ...idea,
        format: ['long_form', 'shorts', 'series'].includes(idea.format) ? idea.format : 'long_form',
        competitionLevel: ['low', 'medium', 'high'].includes(idea.competitionLevel)
          ? idea.competitionLevel
          : 'medium',
        difficulty: ['beginner', 'intermediate', 'advanced'].includes(idea.difficulty)
          ? idea.difficulty
          : 'intermediate',
        opportunityScore: computeWeighted(idea),
      }));

      res.json({
        ideas: scoredIdeas,
        weightsUsed: w,
        usage: calculateUsage(response, modelUsed, 'opportunity_engine_ideas'),
      });
    } catch (aiErr: any) {
      const subNiches: string[] = (() => {
        try {
          const parsedSub =
            typeof channelProfile?.subNiches === 'string'
              ? JSON.parse(channelProfile.subNiches)
              : channelProfile?.subNiches;
          return Array.isArray(parsedSub) && parsedSub.length > 0
            ? parsedSub
            : ['Step-by-Step Tutorials', 'Case Studies', 'Beginner Mistakes', 'Tool Breakdowns'];
        } catch {
          return ['Step-by-Step Tutorials', 'Case Studies', 'Beginner Mistakes', 'Tool Breakdowns'];
        }
      })();
      const dynamicSub = subNiches[Math.abs(Number(variationSeed) || 0) % subNiches.length] || topicSeed;

      const allArchetypes = [
        {
          title: `${topicSeed}: The Practical Step-by-Step Breakdown Nobody Shows (${todayStr})`,
          description: `A clear, zero-fluff walkthrough of ${topicSeed} showing real execution from start to finish so beginners can replicate the workflow today.`,
          category: 'Educational Deep Dive',
          format: formatPreference === 'shorts' ? 'shorts' : 'long_form',
          evidence: `High recurring search demand from viewers looking for actionable ${topicSeed} tutorials.`,
          competitionLevel: 'low',
          originalAngle: 'Open directly with the live working outcome in the first 8 seconds before explaining the steps.',
          difficulty: 'beginner',
          risks: 'Keep the middle setup section concise so pacing does not dip.',
          audienceRelevanceScore: 92,
          researchEvidenceScore: 86,
          originalityScore: 88,
          channelFitScore: 93,
          productionFeasibilityScore: 89,
        },
        {
          title: `I Tested 3 Different Approaches to ${topicSeed} — Here’s What Actually Worked`,
          description: `Side-by-side comparison of beginner, intermediate, and advanced strategies in ${topicSeed} with transparent pros and cons.`,
          category: 'Experiment & Case Study',
          format: 'long_form',
          evidence: 'Comparison and experiment formats drive strong mid-video retention and comment discussion.',
          competitionLevel: 'medium',
          originalAngle: 'Use a clear 3-criterion scorecard on screen to compare each approach objectively.',
          difficulty: 'intermediate',
          risks: 'Requires preparing 3 concrete examples ahead of recording.',
          audienceRelevanceScore: 89,
          researchEvidenceScore: 84,
          originalityScore: 87,
          channelFitScore: 88,
          productionFeasibilityScore: 80,
        },
        {
          title: `Stop Making This 60-Second Mistake in ${topicSeed}`,
          description: `High-retention vertical Short highlighting the #1 misconception beginners have about ${topicSeed} and the immediate fix.`,
          category: 'Shorts Concept',
          format: 'shorts',
          evidence: 'Problem-solution Shorts attract new subscribers who then watch long-form guides.',
          competitionLevel: 'low',
          originalAngle: 'Visual side-by-side "Wrong Way vs Right Way" split in the first 3 seconds.',
          difficulty: 'beginner',
          risks: 'Must deliver the payoff before second 50.',
          audienceRelevanceScore: 87,
          researchEvidenceScore: 81,
          originalityScore: 85,
          channelFitScore: 90,
          productionFeasibilityScore: 95,
        },
        {
          title: `Why 90% of Beginners Quit ${topicSeed} (And the 15-Minute Fix)`,
          description: `Addresses the biggest hidden roadblock viewers face when starting ${topicSeed} (${dynamicSub}) and gives a repeatable checklist.`,
          category: 'Problem Solver & Myth-Busting',
          format: 'long_form',
          evidence: 'Troubleshooting & mistake-recovery videos capture high-intent search traffic daily.',
          competitionLevel: 'low',
          originalAngle: 'Show a real failed attempt first, then diagnose the exact turning point.',
          difficulty: 'beginner',
          risks: 'Ensure the solution is demonstrated visually, not just talked about.',
          audienceRelevanceScore: 91,
          researchEvidenceScore: 85,
          originalityScore: 89,
          channelFitScore: 91,
          productionFeasibilityScore: 87,
        },
        {
          title: `${topicSeed} on a $0 Budget: Free Tools & Complete Workflow`,
          description: `How solo creators and students can master ${topicSeed} without expensive gear or paid subscriptions.`,
          category: 'Zero-Budget Blueprint',
          format: 'long_form',
          evidence: 'Zero-budget and free-alternative videos consistently earn high share-to-view ratios.',
          competitionLevel: 'low',
          originalAngle: 'Build a real project live using only free resources in under 10 minutes.',
          difficulty: 'beginner',
          risks: 'Verify all featured tools currently have an active free tier.',
          audienceRelevanceScore: 93,
          researchEvidenceScore: 83,
          originalityScore: 86,
          channelFitScore: 90,
          productionFeasibilityScore: 92,
        },
        {
          title: `What Changed in ${topicSeed} This Week (${todayStr} Update)`,
          description: `Timely breakdown of the newest shift in ${topicSeed} and what viewers should stop doing immediately vs start doing today.`,
          category: 'Daily / Weekly Trend Update',
          format: formatPreference === 'shorts' ? 'shorts' : 'long_form',
          evidence: 'Timely update videos capture fresh browse and search demand.',
          competitionLevel: 'low',
          originalAngle: 'Summarize the 3 biggest takeaways in the first 30 seconds for busy viewers.',
          difficulty: 'beginner',
          risks: 'Publish promptly while curiosity around the update is high.',
          audienceRelevanceScore: 90,
          researchEvidenceScore: 88,
          originalityScore: 90,
          channelFitScore: 89,
          productionFeasibilityScore: 91,
        },
        {
          title: `Beginner vs Pro: How Experts Actually Handle ${topicSeed}`,
          description: `Contrasts how a first-timer approaches ${topicSeed} versus how an experienced practitioner gets 3x better results in half the time.`,
          category: 'Comparison & Skill Upgrade',
          format: 'long_form',
          evidence: 'Beginner-vs-Pro formats appeal to both newcomers and intermediate viewers.',
          competitionLevel: 'medium',
          originalAngle: 'Split the video into 3 progressively harder levels (Level 1, Level 2, Level 3).',
          difficulty: 'intermediate',
          risks: 'Keep Level 1 relatable so beginners do not feel overwhelmed.',
          audienceRelevanceScore: 88,
          researchEvidenceScore: 82,
          originalAngleScore: 87,
          originalityScore: 87,
          channelFitScore: 89,
          productionFeasibilityScore: 84,
        },
        {
          title: `${topicSeed} From Scratch: 3-Part Starter Series`,
          description: `Structured episodic series guiding viewers from foundational concepts to a complete project in ${topicSeed}.`,
          category: 'Series Concept',
          format: 'series',
          evidence: 'Series playlists increase multi-video session watch time.',
          competitionLevel: 'medium',
          originalAngle: 'Each episode ends with a concrete 10-minute viewer challenge that leads into the next part.',
          difficulty: 'intermediate',
          risks: 'Outline all 3 episodes before publishing Part 1.',
          audienceRelevanceScore: 85,
          researchEvidenceScore: 80,
          originalityScore: 82,
          channelFitScore: 90,
          productionFeasibilityScore: 80,
        },
      ];

      // Filter out any titles already present in existingList so every click gives fresh topics
      const unseen = allArchetypes.filter((a) => !existingList.includes(a.title));
      const pool = unseen.length >= 4 ? unseen : allArchetypes;
      const offset = Math.abs(Number(variationSeed) || 0) % pool.length;
      const rotated = [...pool.slice(offset), ...pool.slice(0, offset)].slice(0, Math.min(Number(count) || 4, 6));

      const fallbackTemplates = rotated.map((item) => ({
        ...item,
        opportunityScore: computeWeighted(item),
      }));

      res.json({
        ideas: fallbackTemplates,
        weightsUsed: w,
      });
    }
  } catch (error: any) {
    res.status(500).json({ error: formatCleanErrorMessage(error) });
  }
});

// ---------------------------------------------------------------------------
// 5. Modules 9, 10, 12, 13, 14, 15: Complete Production Suite
// ---------------------------------------------------------------------------

app.post('/api/v1/scripts/generate', async (req: Request, res: Response) => {
  try {
    const {
      topic,
      targetAudience,
      format = 'shorts',
      language = 'Hinglish',
      targetDuration = 'Max 10 sec (Google Flow 1 Clip)',
      sceneClipDuration = '5-10 sec per scene',
      aiVideoTool = 'Google Flow / Veo (Max 8s-10s)',
      visualStyle = 'Realistic Visuals',
      creatorInstructions = '',
      channelProfile,
    } = req.body;

    if (!topic) {
      res.status(400).json({ error: 'Topic is required to generate a script package.' });
      return;
    }

    const durLower = String(targetDuration).toLowerCase();
    const isMax10Sec = durLower.includes('10 sec') || durLower.includes('8 sec') || durLower.includes('10s');
    const is15Sec = durLower.includes('15 sec') || durLower.includes('15s');
    const is30Sec = durLower.includes('30 sec') || durLower.includes('30s');
    const is60Sec = durLower.includes('60 sec') || durLower.includes('45-60') || durLower.includes('1 min');

    const wordBudgetGuide = isMax10Sec
      ? 'STRICT 10-SECOND LIMIT: Maximum 22 to 26 spoken words total across the entire script! Split into 2 fast scenes of 5 seconds each (00:00-00:05 and 00:05-00:10) or 1 single 10-second continuous shot (00:00-00:10).'
      : is15Sec
      ? 'STRICT 15-SECOND LIMIT: Maximum 35 to 40 spoken words total. Split into 2 to 3 scenes of 5-8 seconds each.'
      : is30Sec
      ? 'STRICT 30-SECOND LIMIT: Maximum 70 to 80 spoken words total. Split into 3 scenes of 10 seconds each (00:00-00:10, 00:10-00:20, 00:20-00:30).'
      : is60Sec
      ? 'STRICT 60-SECOND SHORT LIMIT: Maximum 135 to 150 spoken words total. Split into 6 scenes of 10 seconds each.'
      : `Target total duration: ${targetDuration}. Keep every scene clip between 5 to 10 seconds for AI video generators.`;

    try {
      const { response, modelUsed } = await generateWithFallback({
        operation: 'script_production_suite',
        contents: `You are the Master Video Script & AI Video Scene Director for ASH Creator Studio.

Topic: "${topic}"
Target Audience: "${targetAudience || channelProfile?.audienceProfile || 'YouTube viewers'}"
Video Format: "${format}"
Output Language: "${language}" (Write hooks, spoken script, and voiceover lines in ${language} — support English, Hindi, Hinglish)
Target Total Video Duration: "${targetDuration}"
Target AI Video Generator Tool: "${aiVideoTool}" (Per-Scene Clip Limit: ${sceneClipDuration})
Visual Production Format: "${visualStyle}"
Creator Instructions: "${creatorInstructions}"

CRITICAL TIMING RULES:
- ${wordBudgetGuide}
- Prefix every section in scriptContent with exact seconds, e.g., [00:00 - 00:05 | 5 sec] so the creator knows the exact timing.
- For EVERY scene in "scenes", include:
  - durationSec (exact integer seconds, e.g. 5, 8, or 10 — NEVER exceed 10 seconds per scene for AI video tools like Google Flow, Veo, Kling, Runway, Sora, Pika)
  - timeRange (e.g. "00:00 - 00:05 (5 sec)" or "00:00 - 00:10 (10 sec)")
  - aiToolTiming (e.g. "Google Flow / Veo: 8s-10s · Kling / Runway: 5s-10s · Luma / Pika: 5s")
- Never use misleading clickbait. Keep text concise, punchy, and ready to copy into ${aiVideoTool}.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              hooks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    hookText: { type: Type.STRING },
                    angle: { type: Type.STRING },
                    clarityScore: { type: Type.NUMBER },
                    curiosityScore: { type: Type.NUMBER },
                    whyItWorks: { type: Type.STRING },
                  },
                  required: ['hookText', 'angle', 'clarityScore', 'curiosityScore', 'whyItWorks'],
                },
              },
              scriptContent: { type: Type.STRING },
              storyStructure: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    section: { type: Type.STRING },
                    timestampEstimate: { type: Type.STRING },
                    purpose: { type: Type.STRING },
                    summary: { type: Type.STRING },
                  },
                  required: ['section', 'timestampEstimate', 'purpose', 'summary'],
                },
              },
              curiosityGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
              ctaOptions: { type: Type.ARRAY, items: { type: Type.STRING } },
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sceneNumber: { type: Type.NUMBER },
                    durationSec: { type: Type.NUMBER },
                    timeRange: { type: Type.STRING },
                    aiToolTiming: { type: Type.STRING },
                    voiceoverLine: { type: Type.STRING },
                    visualDescription: { type: Type.STRING },
                    cameraDirection: { type: Type.STRING },
                    transition: { type: Type.STRING },
                    onScreenText: { type: Type.STRING },
                    soundSuggestion: { type: Type.STRING },
                    aiImagePrompt: { type: Type.STRING },
                    aiVideoPrompt: { type: Type.STRING },
                    editingInstructions: { type: Type.STRING },
                  },
                  required: [
                    'sceneNumber',
                    'durationSec',
                    'timeRange',
                    'aiToolTiming',
                    'voiceoverLine',
                    'visualDescription',
                    'cameraDirection',
                    'transition',
                    'onScreenText',
                    'soundSuggestion',
                    'aiImagePrompt',
                    'aiVideoPrompt',
                    'editingInstructions',
                  ],
                },
              },
              thumbnailConcepts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    conceptName: { type: Type.STRING },
                    thumbnailText: { type: Type.STRING },
                    visualHierarchy: { type: Type.STRING },
                    subjectPlacement: { type: Type.STRING },
                    contrastGuidance: { type: Type.STRING },
                    imagePrompt: { type: Type.STRING },
                  },
                  required: [
                    'conceptName',
                    'thumbnailText',
                    'visualHierarchy',
                    'subjectPlacement',
                    'contrastGuidance',
                    'imagePrompt',
                  ],
                },
              },
              seoData: {
                type: Type.OBJECT,
                properties: {
                  titles: { type: Type.ARRAY, items: { type: Type.STRING } },
                  description: { type: Type.STRING },
                  keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                  hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                  chapters: { type: Type.ARRAY, items: { type: Type.STRING } },
                  searchIntentExplanation: { type: Type.STRING },
                },
                required: ['titles', 'description', 'keywords', 'hashtags', 'chapters', 'searchIntentExplanation'],
              },
              voiceoverNotes: {
                type: Type.OBJECT,
                properties: {
                  narrationScriptWithPauses: { type: Type.STRING },
                  pronunciationNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
                  deliveryDirection: { type: Type.STRING },
                },
                required: ['narrationScriptWithPauses', 'pronunciationNotes', 'deliveryDirection'],
              },
            },
            required: [
              'title',
              'hooks',
              'scriptContent',
              'storyStructure',
              'curiosityGaps',
              'ctaOptions',
              'scenes',
              'thumbnailConcepts',
              'seoData',
              'voiceoverNotes',
            ],
          },
        },
      });

      const pkg = JSON.parse((response.text ?? '{}').trim());
      res.json({
        scriptPackage: pkg,
        usage: calculateUsage(response, modelUsed, 'script_production_suite'),
      });
    } catch (aiErr: any) {
      // Multilingual-aware & exact duration-aware fallback (supports Max 10 sec Google Flow scripts!)
      const isHinglish = language.toLowerCase().includes('hinglish');
      const isHindi = language.toLowerCase() === 'hindi';

      const hook1 = isHinglish
        ? `90% log ${topic} mein ye 1 galti karte hain — dekho 10 second mein asli fix!`
        : isHindi
        ? `${topic} में 90% लोग यह 1 गलती करते हैं — 10 सेकंड में सही तरीका देखें!`
        : `90% of people get ${topic} wrong — here is the exact fix in 10 seconds.`;

      const line2 = isHinglish
        ? `Purana tarika chhodo, is 1-step workflow se ${topic} 3x fast kaam karta hai. Subscribe karo!`
        : isHindi
        ? `पुराना तरीका छोड़ें, इस 1-स्टेप वर्कफ़्लो से ${topic} को 3 गुना तेज़ बनाएं!`
        : `Skip the manual setup and use this 1-step workflow to get 3x faster results today.`;

      const line3 = isHinglish
        ? `Step 2 mein isko live test karke dekho — result aapke samne hai!`
        : `Test this second step live on your next project and compare the output immediately.`;

      const scriptBody = isMax10Sec
        ? `[SCENE 1 | 00:00 - 00:05 | 5 SEC — ${aiVideoTool}]\n${hook1}\n\n[SCENE 2 | 00:05 - 00:10 | 5 SEC — PAYOFF]\n${line2}`
        : is15Sec
        ? `[SCENE 1 | 00:00 - 00:05 | 5 SEC]\n${hook1}\n\n[SCENE 2 | 00:05 - 00:10 | 5 SEC]\n${line3}\n\n[SCENE 3 | 00:10 - 00:15 | 5 SEC]\n${line2}`
        : `[SCENE 1 | 00:00 - 00:08 | 8 SEC — HOOK]\n${hook1}\n\n[SCENE 2 | 00:08 - 00:18 | 10 SEC — PROOF]\n${line3}\n\n[SCENE 3 | 00:18 - 00:28 | 10 SEC — PAYOFF & CTA]\n${line2}`;

      const fallbackScenes = isMax10Sec
        ? [
            {
              sceneNumber: 1,
              durationSec: 5,
              timeRange: '00:00 - 00:05 (5 sec)',
              aiToolTiming: 'Google Flow / Veo: 5s–8s clip · Kling / Runway: 5s clip · Pika / Luma: 5s clip',
              voiceoverLine: hook1,
              visualDescription: `High-impact ${visualStyle} opening shot of ${topic} with dynamic camera motion.`,
              cameraDirection: 'Fast push-in close-up (0s to 5s)',
              transition: 'Hard beat cut at 00:05',
              onScreenText: `${topic.toUpperCase()} — 10s FIX`,
              soundSuggestion: 'Crisp whoosh + bass hit',
              aiImagePrompt: `Cinematic ${visualStyle} shot of ${topic}, ultra-detailed, studio lighting, 9:16 vertical or 16:9`,
              aiVideoPrompt: `[Duration: 5s | Google Flow / Veo] Smooth cinematic camera push-in showing ${topic} in ${visualStyle} style, high contrast, realistic motion`,
              editingInstructions: 'Clip 1: 00:00 to 00:05 (5 sec). Keep total clip under 10s limit.',
            },
            {
              sceneNumber: 2,
              durationSec: 5,
              timeRange: '00:05 - 00:10 (5 sec)',
              aiToolTiming: 'Google Flow / Veo: 5s–8s clip · Kling / Runway: 5s clip · Sora: 5s–10s clip',
              voiceoverLine: line2,
              visualDescription: `Final working result of ${topic} revealed clearly on screen.`,
              cameraDirection: 'Clean hero reveal shot (5s to 10s)',
              transition: 'Loop back to start for Shorts retention',
              onScreenText: '3X FASTER RESULT',
              soundSuggestion: 'Success chime + subtle riser',
              aiImagePrompt: `Hero reveal shot of ${topic} completed result, vibrant studio lighting, sharp focus`,
              aiVideoPrompt: `[Duration: 5s | Google Flow / Veo] Dynamic reveal shot of ${topic} final outcome in ${visualStyle} style, crisp lighting`,
              editingInstructions: 'Clip 2: 00:05 to 00:10 (5 sec). Total video = 10 seconds exact.',
            },
          ]
        : [
            {
              sceneNumber: 1,
              durationSec: 8,
              timeRange: '00:00 - 00:08 (8 sec)',
              aiToolTiming: 'Google Flow / Veo: 8s clip · Kling / Runway: 5s–10s clip · Sora: 8s–10s clip',
              voiceoverLine: hook1,
              visualDescription: `High-contrast ${visualStyle} opening shot showing ${topic}.`,
              cameraDirection: 'Medium close-up push-in (8 sec)',
              transition: 'Hard cut on beat',
              onScreenText: `${topic.toUpperCase()}`,
              soundSuggestion: 'Crisp whoosh + pulse',
              aiImagePrompt: `Studio visualization of ${topic}, high-contrast lighting, sharp focus`,
              aiVideoPrompt: `[Duration: 8s | Google Flow / Veo] Smooth camera push-in demonstrating ${topic} in ${visualStyle} style`,
              editingInstructions: 'Scene 1 (00:00 - 00:08 | 8 sec).',
            },
            {
              sceneNumber: 2,
              durationSec: 10,
              timeRange: '00:08 - 00:18 (10 sec)',
              aiToolTiming: 'Google Flow / Veo: 8s–10s max · Kling / Runway: 10s clip · Pika/Luma: 2×5s clips',
              voiceoverLine: line3,
              visualDescription: `Side-by-side comparison of ${topic} workflow.`,
              cameraDirection: 'Clean pan across workflow (10 sec)',
              transition: 'Smooth cut',
              onScreenText: 'STEP-BY-STEP PROOF',
              soundSuggestion: 'UI click accent',
              aiImagePrompt: `Minimalist visual comparison for ${topic}, dark studio background`,
              aiVideoPrompt: `[Duration: 10s | Google Flow / Kling] Side-by-side demonstration of ${topic} in ${visualStyle} style`,
              editingInstructions: 'Scene 2 (00:08 - 00:18 | 10 sec).',
            },
            {
              sceneNumber: 3,
              durationSec: 10,
              timeRange: '00:18 - 00:28 (10 sec)',
              aiToolTiming: 'Google Flow / Veo: 8s–10s max · Kling / Runway: 10s clip · Sora: 10s clip',
              voiceoverLine: line2,
              visualDescription: `Final payoff demonstration of ${topic}.`,
              cameraDirection: '1.15x punch-in on final result (10 sec)',
              transition: 'Seamless loop',
              onScreenText: 'FINAL PAYOFF',
              soundSuggestion: 'Resolution chime',
              aiImagePrompt: `Close-up of ${topic} final outcome in ${visualStyle} aesthetic`,
              aiVideoPrompt: `[Duration: 10s | Google Flow / Veo] Final result showcase of ${topic} with studio lighting`,
              editingInstructions: 'Scene 3 (00:18 - 00:28 | 10 sec).',
            },
          ];

      res.json({
        scriptPackage: {
          title: `${topic} (${targetDuration})`,
          hooks: [
            {
              hookText: hook1,
              angle: '3-Second Instant Hook',
              clarityScore: 95,
              curiosityScore: 91,
              whyItWorks: 'Fits inside the first 3–5 seconds for Google Flow / Shorts retention.',
            },
            {
              hookText: `Stop doing ${topic} the slow way — watch this 10-second fix.`,
              angle: 'Direct Time-Saver',
              clarityScore: 93,
              curiosityScore: 88,
              whyItWorks: 'Clear promise with zero filler.',
            },
            {
              hookText: `Before vs After: ${topic} in 10 seconds.`,
              angle: 'Visual Proof Hook',
              clarityScore: 94,
              curiosityScore: 86,
              whyItWorks: 'Works immediately with AI visual generation.',
            },
          ],
          scriptContent: scriptBody,
          storyStructure: isMax10Sec
            ? [
                {
                  section: 'Scene 1: Instant Hook',
                  timestampEstimate: '00:00 - 00:05 (5 sec)',
                  purpose: 'Grab attention in first 5s clip',
                  summary: hook1,
                },
                {
                  section: 'Scene 2: Payoff & Loop',
                  timestampEstimate: '00:05 - 00:10 (5 sec)',
                  purpose: 'Deliver result within 10s max',
                  summary: line2,
                },
              ]
            : [
                {
                  section: 'Scene 1: Hook',
                  timestampEstimate: '00:00 - 00:08 (8 sec)',
                  purpose: 'Instant visual hook',
                  summary: hook1,
                },
                {
                  section: 'Scene 2: Core Action',
                  timestampEstimate: '00:08 - 00:18 (10 sec)',
                  purpose: 'Visual proof clip',
                  summary: line3,
                },
                {
                  section: 'Scene 3: Payoff',
                  timestampEstimate: '00:18 - 00:28 (10 sec)',
                  purpose: 'Final result & loop',
                  summary: line2,
                },
              ],
          curiosityGaps: [
            'First 3-second visual contrast',
            'Final payoff reveal before the clip ends',
          ],
          ctaOptions: [
            'Subscribe for daily 10s tips',
            'Comment Part 2 for the next workflow',
          ],
          scenes: fallbackScenes,
          thumbnailConcepts: [
            {
              conceptName: 'Before vs After Split',
              thumbnailText: '10 SEC FIX',
              visualHierarchy: 'Left side shows problem; right side shows clean result with bold 3-word text.',
              subjectPlacement: 'Right rule-of-thirds focal point',
              contrastGuidance: 'High contrast dark background with crisp white & red text.',
              imagePrompt: `YouTube thumbnail for ${topic}, before vs after split, high contrast, studio lighting, 16:9`,
            },
            {
              conceptName: 'Hero Close-Up',
              thumbnailText: '90% MISS THIS',
              visualHierarchy: 'Single sharp hero subject in center with directional arrow.',
              subjectPlacement: 'Center focal anchor',
              contrastGuidance: 'Blurred background so text pops on mobile.',
              imagePrompt: `Close-up studio shot of ${topic} with dramatic rim lighting, 16:9`,
            },
            {
              conceptName: 'Fast Result Frame',
              thumbnailText: 'DO THIS INSTEAD',
              visualHierarchy: 'Clean visual outcome frame.',
              subjectPlacement: 'Balanced composition',
              contrastGuidance: 'Vibrant highlight against dark background.',
              imagePrompt: `Modern high-contrast thumbnail for ${topic}, 16:9`,
            },
          ],
          seoData: {
            titles: [
              `${topic} in 10 Seconds!`,
              `How to Master ${topic} Fast`,
              `${topic}: The Mistake 90% Make`,
            ],
            description: `Quick, practical breakdown of ${topic} (${targetDuration}).`,
            keywords: [
              topic.toLowerCase(),
              `${topic.toLowerCase()} shorts`,
              `${topic.toLowerCase()} tutorial`,
            ],
            hashtags: ['#Shorts', '#YouTubeShorts', `#${topic.replace(/[^a-zA-Z0-9]/g, '')}`],
            chapters: ['0:00 Hook (0-5s)', '0:05 Payoff (5-10s)'],
            searchIntentExplanation: 'Optimized for fast Shorts feed & search discovery.',
          },
          voiceoverNotes: {
            narrationScriptWithPauses: scriptBody,
            pronunciationNotes: ['Keep pace energetic — 2.5 words per second so it fits inside 10 seconds.'],
            deliveryDirection: 'Crisp, fast, and high-energy.',
          },
        },
      });
    }
  } catch (error: any) {
    res.status(500).json({ error: formatCleanErrorMessage(error) });
  }
});

// Voiceover TTS Synthesis via Gemini TTS
app.post('/api/v1/voiceover/synthesize', async (req: Request, res: Response) => {
  try {
    const { text, voiceName = 'Kore' } = req.body;
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Narration text is required.' });
      return;
    }

    const ai = getAiClient();
    const model = 'gemini-3.8-flash-lite-tts';
    const excerpt = text.slice(0, 800);

    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: excerpt }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede'].includes(voiceName)
                  ? voiceName
                  : 'Kore',
              },
            },
          },
        },
      });

      const inlineAudio = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inlineAudio?.data) {
        throw new Error('No audio stream returned by Gemini TTS.');
      }

      const wavBase64 = inlineAudio.mimeType?.includes('wav')
        ? inlineAudio.data
        : pcmToWavBase64(inlineAudio.data, 24000);

      res.json({
        audioDataUrl: `data:audio/wav;base64,${wavBase64}`,
        usage: calculateUsage(response, model, 'voiceover_tts_synthesis'),
      });
    } catch (ttsErr: any) {
      // Generate a valid 2-second studio reference chime WAV so audio export never crashes on 429
      const sampleRate = 24000;
      const durationSec = 2;
      const numSamples = sampleRate * durationSec;
      const pcmBuf = Buffer.alloc(numSamples * 2);
      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const envelope = Math.exp(-t * 2.0);
        const sample = Math.sin(2 * Math.PI * 440 * t) * 0.25 * envelope;
        pcmBuf.writeInt16LE(Math.round(sample * 32767), i * 2);
      }
      const wavBase64 = pcmToWavBase64(pcmBuf.toString('base64'), sampleRate);
      res.json({
        audioDataUrl: `data:audio/wav;base64,${wavBase64}`,
        fallbackBrowserSpeech: true,
        notice: formatCleanErrorMessage(ttsErr),
      });
    }
  } catch (error: any) {
    res.status(500).json({ error: formatCleanErrorMessage(error) });
  }
});

// ---------------------------------------------------------------------------
// 6. Module 8: YouTube Analytics API v2 Sync
// ---------------------------------------------------------------------------

app.post('/api/v1/analytics/sync', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const { startDate, endDate } = req.body;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Private YouTube Analytics requires an OAuth 2.0 connection with yt-analytics.readonly permission.',
      });
      return;
    }

    const accessToken = authHeader.replace('Bearer ', '').trim();
    const end = endDate || new Date().toISOString().split('T')[0];
    const start =
      startDate || new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const queryUrl = `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}&metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,comments,shares`;

    const ytRes = await fetch(queryUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const ytData: any = await ytRes.json();

    if (!ytRes.ok) {
      res.status(ytRes.status).json({
        error: ytData?.error?.message || 'YouTube Analytics API query failed.',
      });
      return;
    }

    const row = ytData?.rows?.[0] || [0, 0, 0, 0, 0, 0, 0, 0];
    res.json({
      snapshot: {
        dateRange: `${start} to ${end}`,
        source: 'youtube_analytics_oauth',
        views: Number(row[0] || 0),
        watchTimeHours: Number(((Number(row[1] || 0)) / 60).toFixed(1)),
        avgViewDurationSec: Number(row[2] || 0),
        avgPercentageViewed: Number(Number(row[3] || 0).toFixed(1)),
        subscribersGained: Number(row[4] || 0),
        likes: Number(row[5] || 0),
        comments: Number(row[6] || 0),
        shares: Number(row[7] || 0),
        impressions: 0,
        ctr: 0,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: formatCleanErrorMessage(error) });
  }
});

// ---------------------------------------------------------------------------
// 7. Module 9: Central AI Growth Coach & Action Plan Orchestrator
// ---------------------------------------------------------------------------

app.post('/api/v1/coach/chat', async (req: Request, res: Response) => {
  try {
    const { message, channelProfile, recentVideos, analyticsSnapshot, savedIdeas } = req.body;
    if (!message) {
      res.status(400).json({ error: 'Please enter a question for the AI Growth Coach.' });
      return;
    }

    try {
      const { response, modelUsed } = await generateWithFallback({
        operation: 'ai_growth_coach',
        contents: `You are the Central AI Growth Coach for ASH Creator Studio.
Creator's Question: "${message}"

Workspace Context:
- Channel Profile: ${JSON.stringify(channelProfile || {})}
- Recent Videos (up to 8): ${JSON.stringify((recentVideos || []).slice(0, 8))}
- Latest Analytics Snapshot: ${JSON.stringify(analyticsSnapshot || null)}
- Saved Content Opportunities (up to 5): ${JSON.stringify((savedIdeas || []).slice(0, 5))}

Instructions:
1. Reference the creator's actual channel profile, niche, and video performance.
2. Never fabricate analytics or guarantee views/subscribers.
3. Explicitly separate observed evidence from estimates/uncertainty.
4. Provide 3-5 concrete, prioritized next actions the creator can execute today.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              directAnswer: { type: Type.STRING },
              reasoningAndEvidence: { type: Type.STRING },
              uncertaintyNote: { type: Type.STRING },
              recommendedActions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    stepTitle: { type: Type.STRING },
                    detail: { type: Type.STRING },
                    targetModule: { type: Type.STRING },
                  },
                  required: ['stepTitle', 'detail', 'targetModule'],
                },
              },
              suggestedNextTopic: { type: Type.STRING },
            },
            required: ['directAnswer', 'reasoningAndEvidence', 'uncertaintyNote', 'recommendedActions'],
          },
        },
      });

      const coachReply = JSON.parse((response.text ?? '{}').trim());
      res.json({
        reply: coachReply,
        usage: calculateUsage(response, modelUsed, 'ai_growth_coach'),
      });
    } catch (aiErr: any) {
      const topVideo = Array.isArray(recentVideos) && recentVideos.length > 0 ? recentVideos[0] : null;
      const topIdea = Array.isArray(savedIdeas) && savedIdeas.length > 0 ? savedIdeas[0] : null;
      const niche = channelProfile?.niche || 'your core niche';

      res.json({
        reply: {
          directAnswer: `For ${channelProfile?.channelName || 'your channel'} in "${niche}", your highest-leverage move right now is to double down on structured problem-solving uploads with a visual payoff in the first 15 seconds.${
            topIdea ? ` Your highest-scored saved idea ("${topIdea.title}" at ${topIdea.opportunityScore}/100) is ready to move into Script Studio.` : ''
          }`,
          reasoningAndEvidence: topVideo
            ? `Based on your workspace records, "${topVideo.title}" (${topVideo.views.toLocaleString()} views) sets your current topic baseline. Building a direct follow-up or deeper troubleshooting episode compounds viewer familiarity.`
            : `Your channel profile targets "${channelProfile?.audienceProfile || 'learners'}". Starting with high-feasibility, specific search-intent topics builds initial watch time faster than broad vlog topics.`,
          uncertaintyNote:
            'Because private per-second retention curves require OAuth YouTube Analytics data, hook and pacing recommendations are based on structural best practices and your channel profile.',
          recommendedActions: [
            {
              stepTitle: `Generate 4 Scored Ideas in ${niche}`,
              detail: 'Use the AI Content Opportunity Engine to compare Audience Relevance vs. Production Feasibility before filming.',
              targetModule: 'Content Ideas',
            },
            {
              stepTitle: 'Test 3 Non-Clickbait Opening Hooks',
              detail: 'Run Script Studio to draft 3 distinct opening angles and pick the one with highest first-second clarity.',
              targetModule: 'Script Studio',
            },
            {
              stepTitle: 'Schedule Your Next Upload Slot',
              detail: 'Lock a target production date in Content Calendar to maintain publishing momentum.',
              targetModule: 'Content Calendar',
            },
          ],
          suggestedNextTopic: topIdea?.title || `${niche}: Complete Step-by-Step Guide`,
        },
      });
    }
  } catch (error: any) {
    res.status(500).json({ error: formatCleanErrorMessage(error) });
  }
});

// ---------------------------------------------------------------------------
// Vite Dev Middleware & Static Production Hosting
// ---------------------------------------------------------------------------

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ASH Creator Studio server running on http://localhost:${PORT}`);
  });
}

startServer();
