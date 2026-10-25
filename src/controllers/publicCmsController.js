import {
  ContactInquiry, ContactPage, CookiePolicy, PrivacyPolicy, ServiceCard, WhyChooseUsCard,
} from '../models/index.js';
import notificationService from '../services/NotificationService.js';
import {
  DEFAULT_CONTACT_PAGE, DEFAULT_COOKIE_POLICY, DEFAULT_PRIVACY_POLICY, DEFAULT_SERVICES, DEFAULT_WHY_CHOOSE_US,
} from '../utils/defaultCmsData.js';
import { abort } from '../utils/http.js';

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

/**
 * GET /api/contact-page (or /api/public/contact-page)
 * Retrieve the published Contact Us page settings and clinic info for visitors.
 */
export async function getPublicContactPage(req, res) {
  let page = await ContactPage.findOne({ status: 'published' });

  // Auto-seed default contact page if empty
  if (!page) {
    const count = await ContactPage.count({});
    if (count === 0) {
      page = await ContactPage.create(DEFAULT_CONTACT_PAGE);
    } else {
      page = DEFAULT_CONTACT_PAGE;
    }
  }

  let workingHours = page.working_hours || page.workingHours || [];
  if (typeof workingHours === 'string') {
    try { workingHours = JSON.parse(workingHours); } catch { workingHours = []; }
  }

  let features = page.features || [];
  if (typeof features === 'string') {
    try { features = JSON.parse(features); } catch { features = []; }
  }

  return res.json({
    success: true,
    page: {
      heroBadge: page.hero_badge || page.heroBadge || "We're Here For You",
      heroTitle: page.hero_title || page.heroTitle || 'Contact Dentrivo Dental Care',
      heroSubtitle: page.hero_subtitle || page.heroSubtitle || 'Have a question about our dental treatments, AI diagnostics, or appointments? Send us an inquiry and our clinical team will get back to you promptly.',
      clinicName: page.clinic_name || page.clinicName || 'Dentrivo Dental Clinic',
      address: page.address || 'Sindhubhavan Road, Suite 400, Ahmedabad, Gujarat 380054',
      phone: page.phone || '+91 98765 43210',
      emergencyPhone: page.emergency_phone || page.emergencyPhone || '+91 98765 43211',
      email: page.email || 'info@dentrivo.com',
      workingHours: Array.isArray(workingHours) ? workingHours : [],
      features: Array.isArray(features) ? features : [],
      mapEmbedUrl: page.map_embed_url || page.mapEmbedUrl || DEFAULT_CONTACT_PAGE.map_embed_url,
      status: page.status || 'published',
    },
  });
}

/**
 * POST /api/contact (or /api/public/contact)
 * Handle user inquiry submission and dispatch notification email to noirr.ai13@gmail.com
 */
export async function submitContactInquiry(req, res) {
  const {
    name, email, phone, subject, message,
  } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    abort(422, 'Please enter your full name (minimum 2 characters).');
  }

  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    abort(422, 'Please provide a valid email address so we can reply.');
  }

  if (!message || typeof message !== 'string' || message.trim().length < 5) {
    abort(422, 'Please enter a message or question (minimum 5 characters).');
  }

  // Fetch admin recipient email configuration
  let recipientEmail = 'noirr.ai13@gmail.com';
  try {
    const contactPage = await ContactPage.findOne({});
    if (contactPage?.recipient_email) {
      recipientEmail = contactPage.recipient_email;
    }
  } catch (err) {
    // fallback to noirr.ai13@gmail.com
  }

  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  const cleanPhone = (phone || '').trim();
  const cleanSubject = (subject || 'General Dental Inquiry').trim();
  const cleanMessage = message.trim();

  // Save inquiry to database for admin review & tracking
  const inquiry = await ContactInquiry.create({
    name: cleanName,
    email: cleanEmail,
    phone: cleanPhone,
    subject: cleanSubject,
    message: cleanMessage,
    recipient_email: recipientEmail,
    status: 'new',
    ip_address: req.ip || req.headers['x-forwarded-for'] || '',
    user_agent: req.headers['user-agent'] || '',
  });

  // Dispatch live email to noirr.ai13@gmail.com
  let emailDispatched = true;
  try {
    await notificationService.sendContactInquiryNotification({
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      subject: cleanSubject,
      message: cleanMessage,
      recipient_email: recipientEmail,
    });
  } catch (mailError) {
    console.error('[PublicCmsController] Contact inquiry email dispatch error:', mailError.message);
    emailDispatched = false;
  }

  return res.status(201).json({
    success: true,
    message: 'Thank you for reaching out! Your inquiry has been received and forwarded to our clinical care team.',
    inquiryId: inquiry.id,
    emailDispatched,
  });
}
