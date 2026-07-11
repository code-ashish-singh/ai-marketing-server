import campaignRepo from "../repositories/campaign.repository.js";
import MetaService from "./meta.service.js";
import GoogleAdsService from "./google.service.js";
import AppError from "../utils/AppError.js";
import { PLAN_LIMITS } from "../constants/index.js";

const getMetaCreds = (user) => {
  if (!user.metaAccessToken || !user.metaAdAccountId)
    throw new AppError("Please connect your Meta account in Settings first", 400);
  return { accessToken: user.metaAccessToken, adAccountId: user.metaAdAccountId };
};

const getGoogleCreds = (user) => {
  const customerId     = user.googleAdsCustomerId     || process.env.GOOGLE_CUSTOMER_ID;
  const refreshToken   = user.googleAdsRefreshToken   || process.env.GOOGLE_REFRESH_TOKEN;
  const developerToken = user.googleAdsDeveloperToken || process.env.GOOGLE_DEVELOPER_TOKEN;
  if (!customerId || !refreshToken || !developerToken)
    throw new AppError("Please connect your Google Ads account in Settings first", 400);
  return { customerId, refreshToken, developerToken };
};

const CampaignService = {
  // ─── Create (DB only — draft) ───────────────────────────────
  create: async (userId, userPlan, body) => {
    const count = await campaignRepo.countByUser(userId);
    const limit = PLAN_LIMITS[userPlan]?.campaigns || 2;
    if (count >= limit)
      throw new AppError(`Your ${userPlan} plan allows max ${limit} campaigns. Please upgrade.`, 403);
    return campaignRepo.create({ user: userId, ...body });
  },

  // ─── Get all ────────────────────────────────────────────────
  getAll: (userId, query = {}) => {
    const filter = { user: userId, status: { $ne: "deleted" } };
    if (query.status) filter.status = query.status;
    return campaignRepo.find(filter, { limit: Number(query.limit) || 20, skip: Number(query.skip) || 0 });
  },

  // ─── Get one ────────────────────────────────────────────────
  getOne: async (userId, campaignId) => {
    const campaign = await campaignRepo.findByUserAndId(userId, campaignId);
    if (!campaign) throw new AppError("Campaign not found", 404);
    return campaign;
  },

  // ─── Update ─────────────────────────────────────────────────
  update: async (userId, campaignId, body) => {
    const campaign = await campaignRepo.findByUserAndId(userId, campaignId);
    if (!campaign) throw new AppError("Campaign not found", 404);
    if (campaign.status === "active")
      throw new AppError("Pause the campaign before editing", 400);
    return campaignRepo.updateById(campaignId, body);
  },

  // ─── Publish ────────────────────────────────────────────────
  publish: async (user, campaignId) => {
    const campaign = await campaignRepo.findByUserAndId(user._id, campaignId);
    if (!campaign) throw new AppError("Campaign not found", 404);

    const updates = { status: "active" };
    const platform = campaign.platform || "meta";

    // ── Meta ──
    if (platform === "meta" || platform === "both") {
      const { accessToken, adAccountId } = getMetaCreds(user);
      if (!campaign.metaCampaignId) {
        const mc = await MetaService.createCampaign(accessToken, adAccountId, campaign);
        updates.metaCampaignId = mc.id;
      }
      for (const adSet of campaign.adSets) {
        if (!adSet.metaAdSetId) {
          const ms = await MetaService.createAdSet(accessToken, adAccountId, {
            ...adSet.toObject(),
            metaCampaignId: updates.metaCampaignId || campaign.metaCampaignId,
            startDate: campaign.startDate,
            endDate:   campaign.endDate,
          });
          adSet.metaAdSetId = ms.id;
        }
      }
      await MetaService.publishCampaign(accessToken, updates.metaCampaignId || campaign.metaCampaignId);
      updates.adSets = campaign.adSets;
    }

    // ── Google ──
    if (platform === "google" || platform === "both") {
      const creds = getGoogleCreds(user);
      if (!campaign.googleCampaignId) {
        const gcId = await GoogleAdsService.createCampaign(creds, campaign);
        updates.googleCampaignId = gcId;
        const agId = await GoogleAdsService.createAdGroup(creds, gcId, campaign);
        updates.googleAdGroupId = agId;
        // Create ads from campaign.ads
        for (const ad of campaign.ads) {
          await GoogleAdsService.createAd(creds, agId, ad.adCopy, campaign.googleAdType);
        }
      } else {
        await GoogleAdsService.enableCampaign(creds, campaign.googleCampaignId);
      }
    }

    return campaignRepo.updateById(campaignId, updates);
  },

  // ─── Pause ──────────────────────────────────────────────────
  pause: async (user, campaignId) => {
    const campaign = await campaignRepo.findByUserAndId(user._id, campaignId);
    if (!campaign) throw new AppError("Campaign not found", 404);
    const platform = campaign.platform || "meta";

    if ((platform === "meta" || platform === "both") && campaign.metaCampaignId) {
      const { accessToken } = getMetaCreds(user);
      await MetaService.pauseCampaign(accessToken, campaign.metaCampaignId);
    }
    if ((platform === "google" || platform === "both") && campaign.googleCampaignId) {
      const creds = getGoogleCreds(user);
      await GoogleAdsService.pauseCampaign(creds, campaign.googleCampaignId);
    }
    return campaignRepo.updateById(campaignId, { status: "paused" });
  },

  // ─── Resume ─────────────────────────────────────────────────
  resume: async (user, campaignId) => {
    const campaign = await campaignRepo.findByUserAndId(user._id, campaignId);
    if (!campaign) throw new AppError("Campaign not found", 404);
    const platform = campaign.platform || "meta";

    if ((platform === "meta" || platform === "both") && campaign.metaCampaignId) {
      const { accessToken } = getMetaCreds(user);
      await MetaService.publishCampaign(accessToken, campaign.metaCampaignId);
    }
    if ((platform === "google" || platform === "both") && campaign.googleCampaignId) {
      const creds = getGoogleCreds(user);
      await GoogleAdsService.enableCampaign(creds, campaign.googleCampaignId);
    }
    return campaignRepo.updateById(campaignId, { status: "active" });
  },

  // ─── Update Budget ──────────────────────────────────────────
  updateBudget: async (user, campaignId, budget) => {
    const campaign = await campaignRepo.findByUserAndId(user._id, campaignId);
    if (!campaign) throw new AppError("Campaign not found", 404);
    const platform = campaign.platform || "meta";

    if ((platform === "meta" || platform === "both") && campaign.metaCampaignId) {
      const { accessToken } = getMetaCreds(user);
      await MetaService.updateCampaign(accessToken, campaign.metaCampaignId, { daily_budget: budget });
    }
    // Google budget update handled separately via budget resource
    return campaignRepo.updateById(campaignId, { budget });
  },

  // ─── Sync Insights ──────────────────────────────────────────
  syncInsights: async (user, campaignId) => {
    const campaign = await campaignRepo.findByUserAndId(user._id, campaignId);
    if (!campaign) throw new AppError("Campaign not found", 404);
    const platform = campaign.platform || "meta";

    let insights = { impressions: 0, clicks: 0, spend: 0, reach: 0, ctr: 0, cpc: 0 };

    if ((platform === "meta" || platform === "both") && campaign.metaCampaignId) {
      const { accessToken } = getMetaCreds(user);
      const raw = await MetaService.getCampaignInsights(accessToken, campaign.metaCampaignId);
      insights = {
        impressions: Number(raw.impressions) || 0,
        clicks:      Number(raw.clicks)      || 0,
        spend:       Number(raw.spend)        || 0,
        reach:       Number(raw.reach)        || 0,
        ctr:         Number(raw.ctr)          || 0,
        cpc:         Number(raw.cpc)          || 0,
      };
    }

    if ((platform === "google" || platform === "both") && campaign.googleCampaignId) {
      const creds = getGoogleCreds(user);
      const raw = await GoogleAdsService.getInsights(creds, campaign.googleCampaignId);
      // Merge: add google on top of meta if "both"
      insights.impressions += raw.impressions;
      insights.clicks      += raw.clicks;
      insights.spend       += raw.spend;
      insights.ctr          = insights.clicks ? (insights.clicks / insights.impressions) * 100 : 0;
      insights.cpc          = insights.clicks ? insights.spend / insights.clicks : 0;
    }

    return campaignRepo.updateById(campaignId, { insights });
  },

  // ─── Delete ─────────────────────────────────────────────────
  delete: async (user, campaignId) => {
    const campaign = await campaignRepo.findByUserAndId(user._id, campaignId);
    if (!campaign) throw new AppError("Campaign not found", 404);
    const platform = campaign.platform || "meta";

    if ((platform === "meta" || platform === "both") && campaign.metaCampaignId) {
      try {
        const { accessToken } = getMetaCreds(user);
        await MetaService.deleteCampaign(accessToken, campaign.metaCampaignId);
      } catch { /* ignore if already deleted on Meta */ }
    }
    if ((platform === "google" || platform === "both") && campaign.googleCampaignId) {
      try {
        const creds = getGoogleCreds(user);
        await GoogleAdsService.removeCampaign(creds, campaign.googleCampaignId);
      } catch { /* ignore if already removed on Google */ }
    }
    return campaignRepo.updateById(campaignId, { status: "deleted" });
  },
};

export default CampaignService;
