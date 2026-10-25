import { Router } from 'express';
import multer from 'multer';

import * as authController from '../controllers/auth/authController.js';
import * as publicController from '../controllers/publicController.js';
import * as publicCms from '../controllers/publicCmsController.js';
import * as paymentWebhookController from '../controllers/api/paymentWebhookController.js';

import * as adminDashboard from '../controllers/admin/dashboardController.js';
import * as adminAppointments from '../controllers/admin/appointmentController.js';
import * as adminPatients from '../controllers/admin/patientController.js';
import * as adminDoctors from '../controllers/admin/doctorController.js';
import * as billingController from '../controllers/admin/billingController.js';
import * as analyticsController from '../controllers/admin/analyticsController.js';
import * as settingsController from '../controllers/admin/settingsController.js';
import * as invoicePdfController from '../controllers/admin/invoicePdfController.js';
import * as fileController from '../controllers/admin/fileController.js';
import * as workflowController from '../controllers/admin/workflowController.js';
import * as systemController from '../controllers/admin/systemController.js';
import * as adminChatController from '../controllers/admin/adminChatController.js';
import * as adminCms from '../controllers/admin/cmsController.js';

import * as doctorDashboard from '../controllers/doctor/dashboardController.js';
import * as doctorAppointments from '../controllers/doctor/appointmentController.js';
import * as doctorPatients from '../controllers/doctor/patientController.js';

import * as patientDashboard from '../controllers/patient/dashboardController.js';
import * as patientAppointments from '../controllers/patient/appointmentController.js';
import * as patientProfile from '../controllers/patient/profileController.js';
import * as patientPortal from '../controllers/patient/portalController.js';
import * as patientChat from '../controllers/patient/patientChatController.js';

import * as patientDocumentController from '../controllers/patientDocumentController.js';

import {
  requireClinicAdmin, requireDoctor, requirePatient,
} from '../middleware/auth.js';
import { requireDoctorOrReceptionist } from '../middleware/patientDocumentMiddleware.js';

const router = Router();

// 20MB, matching the original `max:20480` validation rule.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Public / Landing ──────────────────────────────────────────────────
router.get('/pricing', publicController.pricing);
router.get('/public/clinic', publicController.publicClinic);
router.get('/public/treatments', publicController.publicTreatments);
router.get('/public/doctors', publicController.publicDoctors);
router.post('/public/book-appointment', publicController.bookAppointment);
router.post('/public/chat', publicController.publicChat);

// ── Public Dynamic Website Content (CMS) ──────────────────────────────
router.get(['/services', '/public/services'], publicCms.getPublicServices);
router.get(['/why-choose-us', '/public/why-choose-us'], publicCms.getPublicWhyChooseUs);
router.get(['/privacy-policy', '/public/privacy-policy'], publicCms.getPublicPrivacyPolicy);
router.get(['/cookie-policy', '/public/cookie-policy'], publicCms.getPublicCookiePolicy);

// ── Session, Auth & Password Reset ────────────────────────────────────
router.get('/session', authController.session);
router.post('/login', authController.globalLogin);
router.post('/logout', authController.logout);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// ══════════════════════════════════════════════════════════════════════
// API-01: Versioned API Routes (webhooks, external integrations)
// ══════════════════════════════════════════════════════════════════════
// PAY-02: Razorpay Webhook (no auth, signature-verified)
// ── Receptionist (Clinic Admin) ──────────────────────────────────────
router.post('/admin/login', authController.clinicAdminLogin);
router.post('/admin/logout', authController.logout);

router.get('/admin/dashboard', requireClinicAdmin, adminDashboard.index);
router.post('/admin/chat', requireClinicAdmin, adminChatController.chat);

// Appointments
router.get('/admin/appointments', requireClinicAdmin, adminAppointments.index);
router.get('/admin/appointments/create', requireClinicAdmin, adminAppointments.create);
router.post('/admin/appointments', requireClinicAdmin, adminAppointments.store);
router.patch('/admin/appointments/:id/status', requireClinicAdmin, adminAppointments.updateStatus);
router.delete('/admin/appointments/:id', requireClinicAdmin, adminAppointments.destroy);

// Patients
router.get('/admin/patients', requireClinicAdmin, adminPatients.index);
router.get('/admin/patients/:id', requireClinicAdmin, adminPatients.show);
router.post('/admin/patients', requireClinicAdmin, adminPatients.store);
router.put('/admin/patients/:id', requireClinicAdmin, adminPatients.update);
router.delete('/admin/patients/:id', requireClinicAdmin, adminPatients.destroy);

// Doctors
router.get('/admin/doctors', requireClinicAdmin, adminDoctors.index);
router.post('/admin/doctors', requireClinicAdmin, adminDoctors.store);
router.put('/admin/doctors/:id', requireClinicAdmin, adminDoctors.update);
router.post('/admin/doctors/:id/toggle', requireClinicAdmin, adminDoctors.toggleStatus);

// Billing
router.get('/admin/billing', requireClinicAdmin, billingController.index);
router.post('/admin/billing/invoices', requireClinicAdmin, billingController.store);
router.post('/admin/billing/invoices/:id/pay', requireClinicAdmin, billingController.markPaid);
router.post('/admin/billing/invoices/:id/send', requireClinicAdmin, billingController.sendInvoice);
router.get('/admin/billing/invoices/:id/pdf/download', requireClinicAdmin, invoicePdfController.download);
router.get('/admin/billing/invoices/:id/pdf/preview', requireClinicAdmin, invoicePdfController.preview);

// Analytics
router.get('/admin/analytics', requireClinicAdmin, analyticsController.index);

// Settings
router.get('/admin/settings', requireClinicAdmin, settingsController.index);
router.post('/admin/settings/clinic', requireClinicAdmin, settingsController.updateClinic);
router.post('/admin/settings/treatments', requireClinicAdmin, settingsController.storeTreatment);
router.put('/admin/settings/treatments/:id', requireClinicAdmin, settingsController.updateTreatment);

// ── FILE-01 to FILE-04: File & Document Management ──
router.post('/admin/files/upload', requireClinicAdmin, upload.single('file'), fileController.upload);
router.get('/admin/files/:id/preview', requireClinicAdmin, fileController.preview);
router.delete('/admin/files/:id', requireClinicAdmin, fileController.destroy);

// ── WF-01 to WF-04: Workflow Automation ──
router.get('/admin/workflows', requireClinicAdmin, workflowController.index);
router.post('/admin/workflows', requireClinicAdmin, workflowController.store);
router.put('/admin/workflows/:id', requireClinicAdmin, workflowController.update);
router.post('/admin/workflows/:id/toggle', requireClinicAdmin, workflowController.toggleStatus);
router.delete('/admin/workflows/:id', requireClinicAdmin, workflowController.destroy);

// ── AUD-04 / NOT-02 / NOT-03: System Management ──
router.get('/admin/system/audit-logs', requireClinicAdmin, systemController.auditLogs);
router.get('/admin/system/notification-templates', requireClinicAdmin, systemController.notificationTemplates);
router.post('/admin/system/notification-templates', requireClinicAdmin, systemController.saveNotificationTemplate);
router.get('/admin/system/notifications-log', requireClinicAdmin, systemController.notificationsLog);

// ── CMS-01 to CMS-04: Admin Dynamic Website Content Management ───────
// Services Cards Management
router.get('/admin/services', requireClinicAdmin, adminCms.getServices);
router.get('/admin/services/:id', requireClinicAdmin, adminCms.getServiceById);
router.post('/admin/services', requireClinicAdmin, adminCms.createService);
router.put('/admin/services/:id', requireClinicAdmin, adminCms.updateService);
router.delete('/admin/services/:id', requireClinicAdmin, adminCms.deleteService);
router.patch('/admin/services/:id/toggle', requireClinicAdmin, adminCms.toggleServiceStatus);

// Why Choose Us Cards Management
router.get('/admin/why-choose-us', requireClinicAdmin, adminCms.getWhyChooseUs);
router.get('/admin/why-choose-us/:id', requireClinicAdmin, adminCms.getWhyChooseUsById);
router.post('/admin/why-choose-us', requireClinicAdmin, adminCms.createWhyChooseUs);
router.put('/admin/why-choose-us/:id', requireClinicAdmin, adminCms.updateWhyChooseUs);
router.delete('/admin/why-choose-us/:id', requireClinicAdmin, adminCms.deleteWhyChooseUs);
router.patch('/admin/why-choose-us/:id/toggle', requireClinicAdmin, adminCms.toggleWhyChooseUsStatus);

// Privacy Policy Page Management
router.get('/admin/privacy-policy', requireClinicAdmin, adminCms.getPrivacyPolicyAdmin);
router.put('/admin/privacy-policy', requireClinicAdmin, adminCms.updatePrivacyPolicy);
router.post('/admin/privacy-policy/publish', requireClinicAdmin, adminCms.publishPrivacyPolicy);

// Cookie Policy Page Management
router.get('/admin/cookie-policy', requireClinicAdmin, adminCms.getCookiePolicyAdmin);
router.put('/admin/cookie-policy', requireClinicAdmin, adminCms.updateCookiePolicy);
router.post('/admin/cookie-policy/publish', requireClinicAdmin, adminCms.publishCookiePolicy);

// CMS Media & Icon Upload
router.post('/admin/cms/upload', requireClinicAdmin, upload.single('image'), adminCms.uploadMedia);


// ── Doctor ────────────────────────────────────────────────────────────
router.post('/doctor/login', authController.doctorLogin);
router.post('/doctor/logout', authController.logout);

router.get('/doctor/dashboard', requireDoctor, doctorDashboard.index);
router.get('/doctor/appointments', requireDoctor, doctorAppointments.index);
router.patch('/doctor/appointments/:id/status', requireDoctor, doctorAppointments.updateStatus);
router.get('/doctor/patients', requireDoctor, doctorPatients.index);
router.get('/doctor/patients/:id', requireDoctor, doctorPatients.show);

// ── Patient ───────────────────────────────────────────────────────────
router.post('/patient/login', authController.patientLogin);
router.post('/patient/send-otp', authController.sendPatientOtp);
router.post('/patient/login-otp', authController.patientLoginOtp);
router.post('/patient/register', authController.patientRegister);
router.post('/patient/logout', authController.logout);


router.get('/patient/dashboard', requirePatient, patientDashboard.index);
router.get('/patient/appointments', requirePatient, patientAppointments.index);
router.get('/patient/appointments/book', requirePatient, patientAppointments.book);
router.post('/patient/appointments', requirePatient, patientAppointments.store);
router.post('/patient/appointments/:id/cancel', requirePatient, patientAppointments.cancel);
router.get('/patient/profile', requirePatient, patientProfile.index);
router.put('/patient/profile', requirePatient, patientProfile.update);
router.get('/patient/invoices', requirePatient, patientPortal.invoices);
router.get('/patient/chat', requirePatient, patientDashboard.chat);
router.get('/patient/chat/history', requirePatient, patientDashboard.getHistory);
router.post('/patient/chat', requirePatient, patientDashboard.sendMessage);
router.get('/patient/chat/slots', requirePatient, patientChat.getSlots);
router.get('/patient/chat/schedule', requirePatient, patientChat.getSchedule);
router.post('/patient/chat/book-slot', requirePatient, patientChat.bookSlot);

// ── PATIENT DOCUMENTS & DENTAL X-RAYS MANAGEMENT API ─────────────────
router.post(
  ['/patients/:patientId/documents', '/api/patients/:patientId/documents'],
  requireDoctorOrReceptionist,
  upload.single('file'),
  patientDocumentController.uploadDocument,
);
router.get(
  ['/patients/:patientId/documents', '/api/patients/:patientId/documents'],
  patientDocumentController.listDocuments,
);
router.get(
  ['/patients/:patientId/documents/:documentId/view', '/api/patients/:patientId/documents/:documentId/view'],
  patientDocumentController.viewDocument,
);
router.get(
  ['/patients/:patientId/documents/:documentId/download', '/api/patients/:patientId/documents/:documentId/download'],
  patientDocumentController.downloadDocument,
);
router.delete(
  ['/patients/:patientId/documents/:documentId', '/api/patients/:patientId/documents/:documentId'],
  requireDoctorOrReceptionist,
  patientDocumentController.deleteDocument,
);

export default router;
