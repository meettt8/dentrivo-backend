import {
  CookiePolicy, PrivacyPolicy, ServiceCard, WhyChooseUsCard,
} from '../models/index.js';
import {
  DEFAULT_COOKIE_POLICY, DEFAULT_PRIVACY_POLICY, DEFAULT_SERVICES, DEFAULT_WHY_CHOOSE_US,
} from '../utils/defaultCmsData.js';

function normalizeService(s) {
  if (!s) return null;
  return {
    id: String(s._id || s.id),
    title: s.title || '',
    slug: s.slug || '',
    shortDescription: s.shortDescription || s.short_description || '',
    fullDescription: s.fullDescription || s.full_description || '',
    image: s.image || '',
    icon: s.icon || 'bi-heart-pulse',
    buttonText: s.buttonText || s.button_text || 'Book Consultation',
    buttonLink: s.buttonLink || s.button_link || '#book',
    displayOrder: Number(s.displayOrder ?? s.display_order ?? 1),
  };
}

function normalizeWhyChooseUs(w) {
  if (!w) return null;
  return {
    id: String(w._id || w.id),
    number: w.number || '',
    title: w.title || '',
    description: w.description || '',
    icon: w.icon || 'bi-award',
    image: w.image || '',
    displayOrder: Number(w.displayOrder ?? w.display_order ?? 1),
  };
}

/**
 * GET /api/services
 * Retrieve active services for public website visitors.
 */
export async function getPublicServices(req, res) {
  let services = await ServiceCard.find(
    { is_active: true },
    { orderBy: '`display_order` ASC, `created_at` DESC' },
  );

  // Auto-seed if collection is completely empty
  if (!services || services.length === 0) {
    const totalCount = await ServiceCard.count({});
    if (totalCount === 0) {
      for (const item of DEFAULT_SERVICES) {
        await ServiceCard.create(item);
      }
      services = await ServiceCard.find(
        { is_active: true },
        { orderBy: '`display_order` ASC, `created_at` DESC' },
      );
    }
  }

  const activeServices = (services || []).map(normalizeService);
  return res.json({ success: true, services: activeServices });
}

/**
 * GET /api/why-choose-us
 * Retrieve active "Why Choose Us" cards for public website visitors.
 */
export async function getPublicWhyChooseUs(req, res) {
  let cards = await WhyChooseUsCard.find(
    { is_active: true },
    { orderBy: '`display_order` ASC, `created_at` DESC' },
  );

  // Auto-seed if collection is completely empty
  if (!cards || cards.length === 0) {
    const totalCount = await WhyChooseUsCard.count({});
    if (totalCount === 0) {
      for (const item of DEFAULT_WHY_CHOOSE_US) {
        await WhyChooseUsCard.create(item);
      }
      cards = await WhyChooseUsCard.find(
        { is_active: true },
        { orderBy: '`display_order` ASC, `created_at` DESC' },
      );
    }
  }

  const activeCards = (cards || []).map(normalizeWhyChooseUs);
  return res.json({ success: true, items: activeCards });
}

/**
 * GET /api/privacy-policy
 * Retrieve the published Privacy Policy for public visitors.
 * Draft content is never exposed to public visitors.
 */
export async function getPublicPrivacyPolicy(req, res) {
  let policy = await PrivacyPolicy.findOne({ status: 'published' });

  // Auto-seed default policy if empty
  if (!policy) {
    const count = await PrivacyPolicy.count({});
    if (count === 0) {
      policy = await PrivacyPolicy.create(DEFAULT_PRIVACY_POLICY);
    } else {
      // If there is only a draft, return default published content for safety
      policy = DEFAULT_PRIVACY_POLICY;
    }
  }

  let sections = policy.sections || [];
  if (typeof sections === 'string') {
    try { sections = JSON.parse(sections); } catch { sections = []; }
  }

  const sortedSections = [...(Array.isArray(sections) ? sections : [])].sort(
    (a, b) => (Number(a.display_order ?? a.displayOrder ?? 0) - Number(b.display_order ?? b.displayOrder ?? 0)),
  );

  return res.json({
    success: true,
    policy: {
      pageTitle: policy.page_title || policy.pageTitle || 'Privacy Policy',
      introduction: policy.introduction || '',
      pledgeTitle: policy.pledge_title || policy.pledgeTitle || 'Our Patient Privacy Pledge',
      pledgeContent: policy.pledge_content || policy.pledgeContent || '',
      sections: sortedSections,
      effectiveDate: policy.effective_date || policy.effectiveDate || '',
      lastUpdated: policy.last_updated || policy.lastUpdated || 'October 2026',
    },
  });
}

/**
 * GET /api/cookie-policy
 * Retrieve the published Cookie Policy for public visitors.
 * Draft content is never exposed to public visitors.
 */
export async function getPublicCookiePolicy(req, res) {
  let policy = await CookiePolicy.findOne({ status: 'published' });

  // Auto-seed default policy if empty
  if (!policy) {
    const count = await CookiePolicy.count({});
    if (count === 0) {
      policy = await CookiePolicy.create(DEFAULT_COOKIE_POLICY);
    } else {
      policy = DEFAULT_COOKIE_POLICY;
    }
  }

  let sections = policy.sections || [];
  if (typeof sections === 'string') {
    try { sections = JSON.parse(sections); } catch { sections = []; }
  }

  const sortedSections = [...(Array.isArray(sections) ? sections : [])].sort(
    (a, b) => (Number(a.display_order ?? a.displayOrder ?? 0) - Number(b.display_order ?? b.displayOrder ?? 0)),
  );

  return res.json({
    success: true,
    policy: {
      pageTitle: policy.page_title || policy.pageTitle || 'Cookie Policy',
      introduction: policy.introduction || '',
      sections: sortedSections,
      effectiveDate: policy.effective_date || policy.effectiveDate || '',
      lastUpdated: policy.last_updated || policy.lastUpdated || 'October 2026',
    },
  });
}
