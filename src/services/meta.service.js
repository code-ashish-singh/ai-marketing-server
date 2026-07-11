import { metaClient } from "../config/meta.js";
import AppError from "../utils/AppError.js";

const handleMetaError = (err) => {
  const msg = err.response?.data?.error?.message || "Meta API error";
  throw new AppError(msg, err.response?.status || 500);
};

const MetaService = {
  // ─── Account ───────────────────────────────────────────────
  getAdAccount: async (accessToken, adAccountId) => {
    try {
      const { data } = await metaClient(accessToken).get(`/act_${adAccountId}`, {
        params: { fields: "id,name,currency,account_status,balance" },
      });
      return data;
    } catch (err) { handleMetaError(err); }
  },

  // ─── Campaign ──────────────────────────────────────────────
  createCampaign: async (accessToken, adAccountId, payload) => {
    try {
      const { data } = await metaClient(accessToken).post(`/act_${adAccountId}/campaigns`, {
        name: payload.name,
        objective: payload.objective,
        status: "PAUSED",
        special_ad_categories: [],
      });
      return data; // { id }
    } catch (err) { handleMetaError(err); }
  },

  updateCampaign: async (accessToken, metaCampaignId, updates) => {
    try {
      const { data } = await metaClient(accessToken).post(`/${metaCampaignId}`, updates);
      return data;
    } catch (err) { handleMetaError(err); }
  },

  publishCampaign: (accessToken, metaCampaignId) =>
    MetaService.updateCampaign(accessToken, metaCampaignId, { status: "ACTIVE" }),

  pauseCampaign: (accessToken, metaCampaignId) =>
    MetaService.updateCampaign(accessToken, metaCampaignId, { status: "PAUSED" }),

  deleteCampaign: async (accessToken, metaCampaignId) => {
    try {
      const { data } = await metaClient(accessToken).delete(`/${metaCampaignId}`);
      return data;
    } catch (err) { handleMetaError(err); }
  },

  // ─── Ad Set ────────────────────────────────────────────────
  createAdSet: async (accessToken, adAccountId, payload) => {
    try {
      const { data } = await metaClient(accessToken).post(`/act_${adAccountId}/adsets`, {
        name: payload.name,
        campaign_id: payload.metaCampaignId,
        daily_budget: payload.budget, // in paise (INR smallest unit)
        billing_event: "IMPRESSIONS",
        optimization_goal: "REACH",
        status: "PAUSED",
        targeting: buildTargeting(payload.targeting),
        start_time: payload.startDate || undefined,
        end_time: payload.endDate || undefined,
      });
      return data;
    } catch (err) { handleMetaError(err); }
  },

  // ─── Ad Creative + Ad ──────────────────────────────────────
  createAdCreative: async (accessToken, adAccountId, payload) => {
    try {
      const { data } = await metaClient(accessToken).post(`/act_${adAccountId}/adcreatives`, {
        name: `${payload.name}_creative`,
        object_story_spec: {
          page_id: payload.pageId,
          link_data: {
            message: payload.adCopy.primaryText,
            link: payload.link || "https://example.com",
            name: payload.adCopy.headline,
            description: payload.adCopy.description,
            call_to_action: { type: payload.adCopy.cta || "LEARN_MORE" },
            ...(payload.imageHash && { image_hash: payload.imageHash }),
          },
        },
      });
      return data;
    } catch (err) { handleMetaError(err); }
  },

  createAd: async (accessToken, adAccountId, payload) => {
    try {
      const { data } = await metaClient(accessToken).post(`/act_${adAccountId}/ads`, {
        name: payload.name,
        adset_id: payload.metaAdSetId,
        creative: { creative_id: payload.creativeId },
        status: "PAUSED",
      });
      return data;
    } catch (err) { handleMetaError(err); }
  },

  uploadImage: async (accessToken, adAccountId, imageUrl) => {
    try {
      const { data } = await metaClient(accessToken).post(`/act_${adAccountId}/adimages`, {
        url: imageUrl,
      });
      const hash = Object.values(data.images)[0]?.hash;
      return hash;
    } catch (err) { handleMetaError(err); }
  },

  // ─── Insights ──────────────────────────────────────────────
  getCampaignInsights: async (accessToken, metaCampaignId, dateRange = "last_30d") => {
    try {
      const { data } = await metaClient(accessToken).get(`/${metaCampaignId}/insights`, {
        params: {
          fields: "impressions,clicks,spend,reach,ctr,cpc,actions",
          date_preset: dateRange,
        },
      });
      return data.data?.[0] || {};
    } catch (err) { handleMetaError(err); }
  },

  getAccountInsights: async (accessToken, adAccountId, dateRange = "last_30d") => {
    try {
      const { data } = await metaClient(accessToken).get(`/act_${adAccountId}/insights`, {
        params: {
          fields: "impressions,clicks,spend,reach,ctr,cpc",
          date_preset: dateRange,
          level: "campaign",
        },
      });
      return data.data || [];
    } catch (err) { handleMetaError(err); }
  },
};

// ─── Targeting Builder ─────────────────────────────────────
const buildTargeting = (targeting = {}) => ({
  age_min: targeting.ageMin || 18,
  age_max: targeting.ageMax || 65,
  ...(targeting.genders?.length && { genders: targeting.genders }),
  geo_locations: {
    cities: targeting.locations?.map((l) => ({
      key: l.city,
      country: l.country || "IN",
    })) || [],
    countries: targeting.locations?.length ? [] : ["IN"],
  },
  ...(targeting.interests?.length && {
    flexible_spec: [{ interests: targeting.interests.map((i) => ({ id: i.id, name: i.name })) }],
  }),
});

export default MetaService;
