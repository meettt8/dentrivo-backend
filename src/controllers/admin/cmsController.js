import fs from 'node:fs';
import path from 'node:path';
import config from '../../config/index.js';
import {
  ContactInquiry, ContactPage, CookiePolicy, PrivacyPolicy, ServiceCard, WhyChooseUsCard,
} from '../../models/index.js';
import {
  DEFAULT_CONTACT_PAGE, DEFAULT_COOKIE_POLICY, DEFAULT_PRIVACY_POLICY, DEFAULT_SERVICES, DEFAULT_WHY_CHOOSE_US,
} from '../../utils/defaultCmsData.js';
import { abort } from '../../utils/http.js';
import { sanitizeHtml } from '../../utils/sanitize.js';
import { validate } from '../../utils/validate.js';

function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || `service-${Date.now()}`;
}

function normalizeService(s) {
  if (!s) return null;
  return {
    ...s,
    id: String(s._id || s.id),
    title: s.title || '',
    slug: s.slug || slugify(s.title),
    shortDescription: s.shortDescription || s.short_description || '',
    fullDescription: s.fullDescription || s.full_description || '',
    image: s.image || '',
    icon: s.icon || 'bi-heart-pulse',
    buttonText: s.buttonText || s.button_text || 'Book Consultation',
    buttonLink: s.buttonLink || s.button_link || '#book',
    isActive: s.isActive !== undefined ? Boolean(s.isActive) : (s.is_active !== undefined ? Boolean(s.is_active) : true),
    displayOrder: Number(s.displayOrder ?? s.display_order ?? 1),
    createdAt: s.createdAt || s.created_at,
    updatedAt: s.updatedAt || s.updated_at,
  };
}

function normalizeWhyChooseUs(w) {
  if (!w) return null;
  return {
    ...w,
    id: String(w._id || w.id),
    number: w.number || '',
    title: w.title || '',
    description: w.description || '',
    icon: w.icon || 'bi-award',
    image: w.image || '',
    isActive: w.isActive !== undefined ? Boolean(w.isActive) : (w.is_active !== undefined ? Boolean(w.is_active) : true),
    displayOrder: Number(w.displayOrder ?? w.display_order ?? 1),
    createdAt: w.createdAt || w.created_at,
    updatedAt: w.updatedAt || w.updated_at,
  };
}

// ══════════════════════════════════════════════════════════════════════
// 1. SERVICES MANAGEMENT
// ══════════════════════════════════════════════════════════════════════

export async function getServices(req, res) {
  let services = await ServiceCard.find({}, { orderBy: '`display_order` ASC, `created_at` DESC' });

  // Auto-seed if empty
  if (!services || services.length === 0) {
    for (const item of DEFAULT_SERVICES) {
      await ServiceCard.create(item);
    }
    services = await ServiceCard.find({}, { orderBy: '`display_order` ASC, `created_at` DESC' });
  }

  const { search, status } = req.query;
  let filtered = services.map(normalizeService);

  if (status === 'active') {
    filtered = filtered.filter((s) => s.isActive);
  } else if (status === 'inactive') {
    filtered = filtered.filter((s) => !s.isActive);
  }

  if (search && search.trim()) {
    const term = search.trim().toLowerCase();
    filtered = filtered.filter((s) => (
      s.title.toLowerCase().includes(term) ||
      s.shortDescription.toLowerCase().includes(term) ||
      s.slug.toLowerCase().includes(term)
    ));
  }

  return res.json({ success: true, services: filtered });
}

export async function getServiceById(req, res) {
  const service = await ServiceCard.findById(req.params.id);
  if (!service) abort(404, 'Service card not found.');
  return res.json({ success: true, service: normalizeService(service) });
}

export async function createService(req, res) {
  await validate(req.body, {
    title: 'required|string',
    shortDescription: 'sometimes|string',
    short_description: 'sometimes|string',
  });

  const title = (req.body.title || '').trim();
  let slug = (req.body.slug || '').trim() || slugify(title);

  // Ensure unique slug
  const existing = await ServiceCard.findOne({ slug });
  if (existing) {
    slug = `${slug}-${Date.now().toString().slice(-4)}`;
  }

  const short_description = (req.body.shortDescription || req.body.short_description || '').trim();
  const full_description = (req.body.fullDescription || req.body.full_description || '').trim();
  const icon = (req.body.icon || 'bi-heart-pulse').trim();
  const image = (req.body.image || '').trim();
  const button_text = (req.body.buttonText || req.body.button_text || 'Book Consultation').trim();
  const button_link = (req.body.buttonLink || req.body.button_link || '#book').trim();
  const is_active = req.body.isActive !== undefined ? Boolean(req.body.isActive) : (req.body.is_active !== undefined ? Boolean(req.body.is_active) : true);
  const display_order = Number(req.body.displayOrder ?? req.body.display_order ?? 1);

  const created = await ServiceCard.create({
    title,
    slug,
    short_description,
    full_description,
    icon,
    image,
    button_text,
    button_link,
    is_active,
    display_order,
  });

  return res.status(201).json({
    success: true,
    message: 'Service card created successfully.',
    service: normalizeService(created),
  });
}

export async function updateService(req, res) {
  const service = await ServiceCard.findById(req.params.id);
  if (!service) abort(404, 'Service card not found.');

  await validate(req.body, {
    title: 'sometimes|string',
  });

  const updateData = {};
  if (req.body.title !== undefined) updateData.title = String(req.body.title).trim();
  if (req.body.slug !== undefined) updateData.slug = slugify(req.body.slug);
  if (req.body.shortDescription !== undefined || req.body.short_description !== undefined) {
    updateData.short_description = String(req.body.shortDescription ?? req.body.short_description).trim();
  }
  if (req.body.fullDescription !== undefined || req.body.full_description !== undefined) {
    updateData.full_description = String(req.body.fullDescription ?? req.body.full_description).trim();
  }
  if (req.body.icon !== undefined) updateData.icon = String(req.body.icon).trim();
  if (req.body.image !== undefined) updateData.image = String(req.body.image).trim();
  if (req.body.buttonText !== undefined || req.body.button_text !== undefined) {
    updateData.button_text = String(req.body.buttonText ?? req.body.button_text).trim();
  }
  if (req.body.buttonLink !== undefined || req.body.button_link !== undefined) {
    updateData.button_link = String(req.body.buttonLink ?? req.body.button_link).trim();
  }
  if (req.body.isActive !== undefined || req.body.is_active !== undefined) {
    updateData.is_active = Boolean(req.body.isActive ?? req.body.is_active);
  }
  if (req.body.displayOrder !== undefined || req.body.display_order !== undefined) {
    updateData.display_order = Number(req.body.displayOrder ?? req.body.display_order);
  }

  await ServiceCard.update(service.id, updateData);
  const updated = await ServiceCard.findById(service.id);

  return res.json({
    success: true,
    message: 'Service card updated successfully.',
    service: normalizeService(updated),
  });
}

export async function deleteService(req, res) {
  const service = await ServiceCard.findById(req.params.id);
  if (!service) abort(404, 'Service card not found.');

  await ServiceCard.delete(service.id);
  return res.json({ success: true, message: 'Service card deleted successfully.' });
}

export async function toggleServiceStatus(req, res) {
  const service = await ServiceCard.findById(req.params.id);
  if (!service) abort(404, 'Service card not found.');

  const currentStatus = service.is_active !== undefined ? Boolean(service.is_active) : true;
  await ServiceCard.update(service.id, { is_active: !currentStatus });
  const updated = await ServiceCard.findById(service.id);

  return res.json({
    success: true,
    message: `Service card ${!currentStatus ? 'activated' : 'deactivated'} successfully.`,
    service: normalizeService(updated),
  });
}

// ══════════════════════════════════════════════════════════════════════
// 2. WHY CHOOSE US CARDS MANAGEMENT
// ══════════════════════════════════════════════════════════════════════

export async function getWhyChooseUs(req, res) {
  let items = await WhyChooseUsCard.find({}, { orderBy: '`display_order` ASC, `created_at` DESC' });

  // Auto-seed if empty
  if (!items || items.length === 0) {
    for (const card of DEFAULT_WHY_CHOOSE_US) {
      await WhyChooseUsCard.create(card);
    }
    items = await WhyChooseUsCard.find({}, { orderBy: '`display_order` ASC, `created_at` DESC' });
  }

  const { search, status } = req.query;
  let filtered = items.map(normalizeWhyChooseUs);

  if (status === 'active') {
    filtered = filtered.filter((i) => i.isActive);
  } else if (status === 'inactive') {
    filtered = filtered.filter((i) => !i.isActive);
  }

  if (search && search.trim()) {
    const term = search.trim().toLowerCase();
    filtered = filtered.filter((i) => (
      i.title.toLowerCase().includes(term) ||
      i.number.toLowerCase().includes(term) ||
      i.description.toLowerCase().includes(term)
    ));
  }

  return res.json({ success: true, items: filtered });
}

export async function getWhyChooseUsById(req, res) {
  const item = await WhyChooseUsCard.findById(req.params.id);
  if (!item) abort(404, 'Why Choose Us card not found.');
  return res.json({ success: true, item: normalizeWhyChooseUs(item) });
}

export async function createWhyChooseUs(req, res) {
  await validate(req.body, {
    title: 'required|string',
  });

  const title = (req.body.title || '').trim();
  const number = (req.body.number || '').trim();
  const description = (req.body.description || '').trim();
  const icon = (req.body.icon || 'bi-award').trim();
  const image = (req.body.image || '').trim();
  const is_active = req.body.isActive !== undefined ? Boolean(req.body.isActive) : (req.body.is_active !== undefined ? Boolean(req.body.is_active) : true);
  const display_order = Number(req.body.displayOrder ?? req.body.display_order ?? 1);

  const created = await WhyChooseUsCard.create({
    title,
    number,
    description,
    icon,
    image,
    is_active,
    display_order,
  });

  return res.status(201).json({
    success: true,
    message: 'Card created successfully.',
    item: normalizeWhyChooseUs(created),
  });
}

export async function updateWhyChooseUs(req, res) {
  const item = await WhyChooseUsCard.findById(req.params.id);
  if (!item) abort(404, 'Why Choose Us card not found.');

  await validate(req.body, {
    title: 'sometimes|string',
  });

  const updateData = {};
  if (req.body.title !== undefined) updateData.title = String(req.body.title).trim();
  if (req.body.number !== undefined) updateData.number = String(req.body.number).trim();
  if (req.body.description !== undefined) updateData.description = String(req.body.description).trim();
  if (req.body.icon !== undefined) updateData.icon = String(req.body.icon).trim();
  if (req.body.image !== undefined) updateData.image = String(req.body.image).trim();
  if (req.body.isActive !== undefined || req.body.is_active !== undefined) {
    updateData.is_active = Boolean(req.body.isActive ?? req.body.is_active);
  }
  if (req.body.displayOrder !== undefined || req.body.display_order !== undefined) {
    updateData.display_order = Number(req.body.displayOrder ?? req.body.display_order);
  }

  await WhyChooseUsCard.update(item.id, updateData);
  const updated = await WhyChooseUsCard.findById(item.id);

  return res.json({
    success: true,
    message: 'Card updated successfully.',
    item: normalizeWhyChooseUs(updated),
  });
}

export async function deleteWhyChooseUs(req, res) {
  const item = await WhyChooseUsCard.findById(req.params.id);
  if (!item) abort(404, 'Why Choose Us card not found.');

  await WhyChooseUsCard.delete(item.id);
  return res.json({ success: true, message: 'Card deleted successfully.' });
}

export async function toggleWhyChooseUsStatus(req, res) {
  const item = await WhyChooseUsCard.findById(req.params.id);
  if (!item) abort(404, 'Why Choose Us card not found.');

  const currentStatus = item.is_active !== undefined ? Boolean(item.is_active) : true;
  await WhyChooseUsCard.update(item.id, { is_active: !currentStatus });
  const updated = await WhyChooseUsCard.findById(item.id);

  return res.json({
    success: true,
    message: `Card ${!currentStatus ? 'activated' : 'deactivated'} successfully.`,
    item: normalizeWhyChooseUs(updated),
  });
}

// ══════════════════════════════════════════════════════════════════════
// 3. PRIVACY POLICY MANAGEMENT
// ══════════════════════════════════════════════════════════════════════

export async function getPrivacyPolicyAdmin(req, res) {
  let policy = await PrivacyPolicy.findOne({});
  if (!policy) {
    policy = await PrivacyPolicy.create(DEFAULT_PRIVACY_POLICY);
  }

  // Normalize sections
  let sections = policy.sections || [];
  if (typeof sections === 'string') {
    try { sections = JSON.parse(sections); } catch { sections = []; }
  }

  return res.json({
    success: true,
    policy: {
      ...policy,
      pageTitle: policy.page_title || policy.pageTitle || 'Privacy Policy',
      introduction: policy.introduction || '',
      pledgeTitle: policy.pledge_title || policy.pledgeTitle || 'Our Patient Privacy Pledge',
      pledgeContent: policy.pledge_content || policy.pledgeContent || '',
      sections: Array.isArray(sections) ? sections : [],
      effectiveDate: policy.effective_date || policy.effectiveDate || '',
      lastUpdated: policy.last_updated || policy.lastUpdated || '',
      status: policy.status || 'published',
    },
  });
}

export async function updatePrivacyPolicy(req, res) {
  await validate(req.body, {
    pageTitle: 'sometimes|string',
    page_title: 'sometimes|string',
  });

  const page_title = (req.body.pageTitle || req.body.page_title || 'Privacy Policy').trim();
  const introduction = sanitizeHtml(req.body.introduction || '');
  const pledge_title = (req.body.pledgeTitle || req.body.pledge_title || '').trim();
  const pledge_content = sanitizeHtml(req.body.pledgeContent || req.body.pledge_content || '');
  const effective_date = (req.body.effectiveDate || req.body.effective_date || '').trim();
  const last_updated = (req.body.lastUpdated || req.body.last_updated || '').trim() || new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const status = req.body.status === 'draft' ? 'draft' : 'published';

  const rawSections = Array.isArray(req.body.sections) ? req.body.sections : [];
  const sections = rawSections.map((sec, idx) => ({
    id: sec.id || `sec-${idx + 1}`,
    heading: String(sec.heading || `Section ${idx + 1}`).trim(),
    content: sanitizeHtml(sec.content || ''),
    display_order: Number(sec.displayOrder ?? sec.display_order ?? idx + 1),
  }));

  let policy = await PrivacyPolicy.findOne({});
  const updateData = {
    page_title,
    introduction,
    pledge_title,
    pledge_content,
    sections,
    effective_date,
    last_updated,
    status,
  };

  if (policy) {
    await PrivacyPolicy.update(policy.id, updateData);
    policy = await PrivacyPolicy.findById(policy.id);
  } else {
    policy = await PrivacyPolicy.create(updateData);
  }

  return res.json({
    success: true,
    message: status === 'published' ? 'Privacy Policy published successfully.' : 'Privacy Policy draft saved.',
    policy: {
      ...policy,
      pageTitle: policy.page_title,
      introduction: policy.introduction,
      pledgeTitle: policy.pledge_title,
      pledgeContent: policy.pledge_content,
      sections: policy.sections,
      effectiveDate: policy.effective_date,
      lastUpdated: policy.last_updated,
      status: policy.status,
    },
  });
}

export async function publishPrivacyPolicy(req, res) {
  let policy = await PrivacyPolicy.findOne({});
  if (!policy) {
    policy = await PrivacyPolicy.create({ ...DEFAULT_PRIVACY_POLICY, status: 'published' });
  } else {
    await PrivacyPolicy.update(policy.id, {
      status: 'published',
      last_updated: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    });
    policy = await PrivacyPolicy.findById(policy.id);
  }

  return res.json({
    success: true,
    message: 'Privacy Policy published successfully to public website.',
    policy,
  });
}

// ══════════════════════════════════════════════════════════════════════
// 4. COOKIE POLICY MANAGEMENT
// ══════════════════════════════════════════════════════════════════════

export async function getCookiePolicyAdmin(req, res) {
  let policy = await CookiePolicy.findOne({});
  if (!policy) {
    policy = await CookiePolicy.create(DEFAULT_COOKIE_POLICY);
  }

  let sections = policy.sections || [];
  if (typeof sections === 'string') {
    try { sections = JSON.parse(sections); } catch { sections = []; }
  }

  return res.json({
    success: true,
    policy: {
      ...policy,
      pageTitle: policy.page_title || policy.pageTitle || 'Cookie Policy',
      introduction: policy.introduction || '',
      sections: Array.isArray(sections) ? sections : [],
      effectiveDate: policy.effective_date || policy.effectiveDate || '',
      lastUpdated: policy.last_updated || policy.lastUpdated || '',
      status: policy.status || 'published',
    },
  });
}

export async function updateCookiePolicy(req, res) {
  await validate(req.body, {
    pageTitle: 'sometimes|string',
    page_title: 'sometimes|string',
  });

  const page_title = (req.body.pageTitle || req.body.page_title || 'Cookie Policy').trim();
  const introduction = sanitizeHtml(req.body.introduction || '');
  const effective_date = (req.body.effectiveDate || req.body.effective_date || '').trim();
  const last_updated = (req.body.lastUpdated || req.body.last_updated || '').trim() || new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const status = req.body.status === 'draft' ? 'draft' : 'published';

  const rawSections = Array.isArray(req.body.sections) ? req.body.sections : [];
  const sections = rawSections.map((sec, idx) => ({
    id: sec.id || `sec-${idx + 1}`,
    heading: String(sec.heading || `Section ${idx + 1}`).trim(),
    content: sanitizeHtml(sec.content || ''),
    display_order: Number(sec.displayOrder ?? sec.display_order ?? idx + 1),
  }));

  let policy = await CookiePolicy.findOne({});
  const updateData = {
    page_title,
    introduction,
    sections,
    effective_date,
    last_updated,
    status,
  };

  if (policy) {
    await CookiePolicy.update(policy.id, updateData);
    policy = await CookiePolicy.findById(policy.id);
  } else {
    policy = await CookiePolicy.create(updateData);
  }

  return res.json({
    success: true,
    message: status === 'published' ? 'Cookie Policy published successfully.' : 'Cookie Policy draft saved.',
    policy: {
      ...policy,
      pageTitle: policy.page_title,
      introduction: policy.introduction,
      sections: policy.sections,
      effectiveDate: policy.effective_date,
      lastUpdated: policy.last_updated,
      status: policy.status,
    },
  });
}

export async function publishCookiePolicy(req, res) {
  let policy = await CookiePolicy.findOne({});
  if (!policy) {
    policy = await CookiePolicy.create({ ...DEFAULT_COOKIE_POLICY, status: 'published' });
  } else {
    await CookiePolicy.update(policy.id, {
      status: 'published',
      last_updated: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    });
    policy = await CookiePolicy.findById(policy.id);
  }

  return res.json({
    success: true,
    message: 'Cookie Policy published successfully to public website.',
    policy,
  });
}

// ══════════════════════════════════════════════════════════════════════
// 5. CMS MEDIA UPLOAD
// ══════════════════════════════════════════════════════════════════════

export async function uploadMedia(req, res) {
  if (!req.file) {
    abort(422, 'No image file uploaded.');
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif'];
  if (!allowedTypes.includes(req.file.mimetype)) {
    abort(422, 'Only image files (JPEG, PNG, WebP, SVG, GIF) are permitted.');
  }

  const cmsStorageDir = path.join(config.filesystem.storagePath, 'cms');
  fs.mkdirSync(cmsStorageDir, { recursive: true });

  const safeExt = path.extname(req.file.originalname) || '.png';
  const fileName = `cms-${Date.now()}-${Math.random().toString(36).substring(2, 8)}${safeExt}`;
  fs.writeFileSync(path.join(cmsStorageDir, fileName), req.file.buffer);

  const publicUrl = `/storage/cms/${fileName}`;
  return res.status(201).json({
    success: true,
    message: 'Image uploaded successfully.',
    url: publicUrl,
    filename: fileName,
  });
}

// ══════════════════════════════════════════════════════════════════════
// 6. CONTACT US PAGE MANAGEMENT & INQUIRIES
// ══════════════════════════════════════════════════════════════════════

export async function getContactPageAdmin(req, res) {
  let page = await ContactPage.findOne({});
  if (!page) {
    page = await ContactPage.create(DEFAULT_CONTACT_PAGE);
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
      ...page,
      id: String(page._id || page.id),
      heroBadge: page.hero_badge || page.heroBadge || "We're Here For You",
      heroTitle: page.hero_title || page.heroTitle || 'Contact Dentrivo Dental Care',
      heroSubtitle: page.hero_subtitle || page.heroSubtitle || '',
      clinicName: page.clinic_name || page.clinicName || 'Dentrivo Dental Clinic',
      address: page.address || 'Sindhubhavan Road, Suite 400, Ahmedabad, Gujarat 380054',
      phone: page.phone || '+91 98765 43210',
      emergencyPhone: page.emergency_phone || page.emergencyPhone || '+91 98765 43211',
      email: page.email || 'info@dentrivo.com',
      recipientEmail: page.recipient_email || page.recipientEmail || 'noirr.ai13@gmail.com',
      workingHours: Array.isArray(workingHours) ? workingHours : [],
      features: Array.isArray(features) ? features : [],
      mapEmbedUrl: page.map_embed_url || page.mapEmbedUrl || DEFAULT_CONTACT_PAGE.map_embed_url,
      status: page.status || 'published',
      updatedAt: page.updated_at || page.updatedAt,
    },
  });
}

export async function updateContactPage(req, res) {
  const hero_badge = (req.body.heroBadge || req.body.hero_badge || "We're Here For You").trim();
  const hero_title = (req.body.heroTitle || req.body.hero_title || 'Contact Dentrivo Dental Care').trim();
  const hero_subtitle = (req.body.heroSubtitle || req.body.hero_subtitle || '').trim();
  const clinic_name = (req.body.clinicName || req.body.clinic_name || 'Dentrivo Dental Clinic').trim();
  const address = (req.body.address || '').trim();
  const phone = (req.body.phone || '').trim();
  const emergency_phone = (req.body.emergencyPhone || req.body.emergency_phone || '').trim();
  const email = (req.body.email || '').trim();
  const recipient_email = (req.body.recipientEmail || req.body.recipient_email || 'noirr.ai13@gmail.com').trim().toLowerCase();
  const map_embed_url = (req.body.mapEmbedUrl || req.body.map_embed_url || DEFAULT_CONTACT_PAGE.map_embed_url).trim();
  const status = req.body.status === 'draft' ? 'draft' : 'published';

  const rawWorkingHours = Array.isArray(req.body.workingHours) ? req.body.workingHours : [];
  const working_hours = rawWorkingHours.map((wh) => ({
    days: String(wh.days || '').trim(),
    hours: String(wh.hours || '').trim(),
    note: String(wh.note || '').trim(),
  }));

  const rawFeatures = Array.isArray(req.body.features) ? req.body.features : [];
  const features = rawFeatures.map((f) => ({
    icon: String(f.icon || 'bi-check-circle').trim(),
    title: String(f.title || '').trim(),
    description: String(f.description || '').trim(),
  }));

  let page = await ContactPage.findOne({});
  const updateData = {
    hero_badge,
    hero_title,
    hero_subtitle,
    clinic_name,
    address,
    phone,
    emergency_phone,
    email,
    recipient_email,
    working_hours,
    features,
    map_embed_url,
    status,
  };

  if (page) {
    await ContactPage.update(page.id, updateData);
    page = await ContactPage.findById(page.id);
  } else {
    page = await ContactPage.create(updateData);
  }

  return res.json({
    success: true,
    message: status === 'published' ? 'Contact Us page published successfully.' : 'Contact Us page draft saved.',
    page: {
      ...page,
      id: String(page._id || page.id),
      heroBadge: page.hero_badge,
      heroTitle: page.hero_title,
      heroSubtitle: page.hero_subtitle,
      clinicName: page.clinic_name,
      address: page.address,
      phone: page.phone,
      emergencyPhone: page.emergency_phone,
      email: page.email,
      recipientEmail: page.recipient_email,
      workingHours: page.working_hours,
      features: page.features,
      mapEmbedUrl: page.map_embed_url,
      status: page.status,
    },
  });
}

export async function publishContactPage(req, res) {
  let page = await ContactPage.findOne({});
  if (!page) {
    page = await ContactPage.create({ ...DEFAULT_CONTACT_PAGE, status: 'published' });
  } else {
    await ContactPage.update(page.id, { status: 'published' });
    page = await ContactPage.findById(page.id);
  }

  return res.json({
    success: true,
    message: 'Contact Us page published live successfully.',
    page,
  });
}

export async function getContactInquiries(req, res) {
  const { search, status } = req.query;
  const filter = {};

  if (status && ['new', 'in_progress', 'resolved'].includes(status)) {
    filter.status = status;
  }

  let inquiries = await ContactInquiry.find(filter, { orderBy: '`created_at` DESC, `id` DESC' });

  if (search && search.trim()) {
    const term = search.trim().toLowerCase();
    inquiries = (inquiries || []).filter((inq) => (
      (inq.name || '').toLowerCase().includes(term) ||
      (inq.email || '').toLowerCase().includes(term) ||
      (inq.subject || '').toLowerCase().includes(term) ||
      (inq.message || '').toLowerCase().includes(term)
    ));
  }

  const normalized = (inquiries || []).map((inq) => ({
    id: String(inq._id || inq.id),
    name: inq.name || '',
    email: inq.email || '',
    phone: inq.phone || '',
    subject: inq.subject || '',
    message: inq.message || '',
    recipientEmail: inq.recipient_email || 'noirr.ai13@gmail.com',
    status: inq.status || 'new',
    ipAddress: inq.ip_address || '',
    createdAt: inq.created_at || inq.createdAt,
    updatedAt: inq.updated_at || inq.updatedAt,
  }));

  return res.json({
    success: true,
    inquiries: normalized,
    total: normalized.length,
    counts: {
      all: normalized.length,
      new: normalized.filter((i) => i.status === 'new').length,
      in_progress: normalized.filter((i) => i.status === 'in_progress').length,
      resolved: normalized.filter((i) => i.status === 'resolved').length,
    },
  });
}

export async function updateContactInquiryStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;

  if (!['new', 'in_progress', 'resolved'].includes(status)) {
    abort(422, 'Invalid inquiry status. Allowed: new, in_progress, resolved');
  }

  const inquiry = await ContactInquiry.findById(id);
  if (!inquiry) {
    abort(404, 'Contact inquiry not found.');
  }

  await ContactInquiry.update(id, { status });
  const updated = await ContactInquiry.findById(id);

  return res.json({
    success: true,
    message: `Inquiry status marked as ${status}.`,
    inquiry: {
      ...updated,
      id: String(updated._id || updated.id),
    },
  });
}

export async function deleteContactInquiry(req, res) {
  const { id } = req.params;
  const inquiry = await ContactInquiry.findById(id);
  if (!inquiry) {
    abort(404, 'Contact inquiry not found.');
  }

  await ContactInquiry.delete(id);
  return res.json({
    success: true,
    message: 'Inquiry deleted successfully.',
  });
}
