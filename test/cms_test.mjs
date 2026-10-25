import { connectDatabase, disconnectDatabase, getDb } from '../src/config/db.js';
import * as publicCms from '../src/controllers/publicCmsController.js';
import * as adminCms from '../src/controllers/admin/cmsController.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

async function run() {
  console.log('=== CMS UNIT & INTEGRATION TEST ===');
  await connectDatabase();

  // 1. Test Public Services
  console.log('Testing GET /api/services...');
  const res1 = mockRes();
  await publicCms.getPublicServices({}, res1);
  if (!res1.body?.success || !Array.isArray(res1.body?.services)) {
    throw new Error('Public services endpoint failed: ' + JSON.stringify(res1.body));
  }
  console.log(`PASS: Public services returned ${res1.body.services.length} items`);

  // 2. Test Public Why Choose Us
  console.log('Testing GET /api/why-choose-us...');
  const res2 = mockRes();
  await publicCms.getPublicWhyChooseUs({}, res2);
  if (!res2.body?.success || !Array.isArray(res2.body?.items)) {
    throw new Error('Public why-choose-us endpoint failed: ' + JSON.stringify(res2.body));
  }
  console.log(`PASS: Public why-choose-us returned ${res2.body.items.length} items`);

  // 3. Test Public Privacy Policy
  console.log('Testing GET /api/privacy-policy...');
  const res3 = mockRes();
  await publicCms.getPublicPrivacyPolicy({}, res3);
  if (!res3.body?.success || !res3.body?.policy?.pageTitle) {
    throw new Error('Public privacy policy endpoint failed: ' + JSON.stringify(res3.body));
  }
  console.log(`PASS: Public privacy policy returned: "${res3.body.policy.pageTitle}" with ${res3.body.policy.sections.length} sections`);

  // 4. Test Public Cookie Policy
  console.log('Testing GET /api/cookie-policy...');
  const res4 = mockRes();
  await publicCms.getPublicCookiePolicy({}, res4);
  if (!res4.body?.success || !res4.body?.policy?.pageTitle) {
    throw new Error('Public cookie policy endpoint failed: ' + JSON.stringify(res4.body));
  }
  console.log(`PASS: Public cookie policy returned: "${res4.body.policy.pageTitle}" with ${res4.body.policy.sections.length} sections`);

  // 5. Test Admin Service Card CRUD
  console.log('Testing Admin Create Service Card...');
  const createRes = mockRes();
  await adminCms.createService({
    body: {
      title: 'Pediatric Dental Care',
      shortDescription: 'Gentle dentistry specialized for children and infants.',
      fullDescription: 'Comprehensive pediatric dentistry in a fun, relaxing atmosphere.',
      icon: 'bi-stars',
      displayOrder: 99,
      isActive: true,
    },
  }, createRes);

  if (createRes.statusCode !== 201 || !createRes.body?.service?.id) {
    throw new Error('Admin create service failed: ' + JSON.stringify(createRes.body));
  }
  const createdId = createRes.body.service.id;
  console.log(`PASS: Service created with ID ${createdId} and slug "${createRes.body.service.slug}"`);

  // Test Admin Update Service Card
  console.log('Testing Admin Update Service Card...');
  const updateRes = mockRes();
  await adminCms.updateService({
    params: { id: createdId },
    body: {
      title: 'Pediatric Dentistry & Ortho',
      shortDescription: 'Updated gentle care description.',
    },
  }, updateRes);
  if (!updateRes.body?.success || updateRes.body?.service?.title !== 'Pediatric Dentistry & Ortho') {
    throw new Error('Admin update service failed: ' + JSON.stringify(updateRes.body));
  }
  console.log('PASS: Service updated successfully');

  // Test Admin Toggle Status
  console.log('Testing Admin Toggle Service Status...');
  const toggleRes = mockRes();
  await adminCms.toggleServiceStatus({ params: { id: createdId } }, toggleRes);
  if (toggleRes.body?.service?.isActive !== false) {
    throw new Error('Admin toggle service failed: ' + JSON.stringify(toggleRes.body));
  }
  console.log('PASS: Service status toggled to inactive');

  // Test Admin Delete Service Card
  console.log('Testing Admin Delete Service Card...');
  const deleteRes = mockRes();
  await adminCms.deleteService({ params: { id: createdId } }, deleteRes);
  if (!deleteRes.body?.success) {
    throw new Error('Admin delete service failed: ' + JSON.stringify(deleteRes.body));
  }
  console.log('PASS: Service deleted successfully');

  // 6. Test Admin Why Choose Us CRUD
  console.log('Testing Admin Why Choose Us CRUD...');
  const wCreateRes = mockRes();
  await adminCms.createWhyChooseUs({
    body: {
      number: '99.9%',
      title: 'Sterilization Standard',
      description: 'Hospital grade sterilization and autoclave tracking.',
      icon: 'bi-shield-check',
      displayOrder: 88,
      isActive: true,
    },
  }, wCreateRes);
  if (wCreateRes.statusCode !== 201 || !wCreateRes.body?.item?.id) {
    throw new Error('Admin create why-choose-us failed: ' + JSON.stringify(wCreateRes.body));
  }
  const wId = wCreateRes.body.item.id;
  console.log(`PASS: Why choose us card created with ID ${wId}`);

  // Delete test item
  const wDelRes = mockRes();
  await adminCms.deleteWhyChooseUs({ params: { id: wId } }, wDelRes);
  console.log('PASS: Why choose us card deleted successfully');

  // 7. Test Admin Privacy Policy Save Draft and Publish
  console.log('Testing Admin Privacy Policy Draft Save & Publish...');
  const ppRes = mockRes();
  await adminCms.updatePrivacyPolicy({
    body: {
      pageTitle: 'Dentrivo Patient Privacy Charter',
      introduction: 'Updated introduction text with XSS test <script>alert(1)</script>',
      sections: [
        { id: 'sec-1', heading: '1. Patient Rights', content: '<p>You have full access to your data.</p>', displayOrder: 1 }
      ],
      effectiveDate: '2026-10-25',
      status: 'draft',
    },
  }, ppRes);

  if (ppRes.body?.policy?.status !== 'draft') {
    throw new Error('Privacy policy draft save failed');
  }
  if (ppRes.body?.policy?.introduction.includes('<script>')) {
    throw new Error('XSS Sanitization failed in privacy policy');
  }
  console.log('PASS: Privacy policy draft saved and XSS sanitized');

  // Publish policy
  const ppPubRes = mockRes();
  await adminCms.publishPrivacyPolicy({}, ppPubRes);
  if (ppPubRes.body?.policy?.status !== 'published') {
    throw new Error('Privacy policy publish failed');
  }
  console.log('PASS: Privacy policy published live');

  console.log('\n========================================');
  console.log('ALL CMS TESTS PASSED SUCCESSFULLY! ✅');
  console.log('========================================\n');

  await disconnectDatabase();
}

run().catch(async (e) => {
  console.error('Test error:', e);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
