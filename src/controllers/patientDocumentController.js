import fs from 'node:fs';
import path from 'node:path';
import config from '../config/index.js';
import { ClinicAdmin, Doctor, MedicalFile, Patient } from '../models/index.js';
import auditService from '../services/AuditService.js';

const ALLOWED_PDF_MIMES = ['application/pdf'];
const ALLOWED_XRAY_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * Upload a document (PDF or X-Ray) for a patient.
 * POST /api/patients/:patientId/documents
 */
export async function uploadDocument(req, res) {
  const { patientId } = req.params;
  const { type } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(422).json({ message: 'No file was uploaded.' });
  }

  if (!['pdf', 'xray'].includes(type)) {
    return res.status(422).json({ message: 'Invalid document type. Must be "pdf" or "xray".' });
  }

  // Validate File MIME Type
  if (type === 'pdf') {
    if (!ALLOWED_PDF_MIMES.includes(file.mimetype)) {
      return res.status(422).json({ message: 'Only PDF files are allowed.' });
    }
  } else if (type === 'xray') {
    if (!ALLOWED_XRAY_MIMES.includes(file.mimetype)) {
      return res.status(422).json({ message: 'Only JPG, PNG, and WEBP images are allowed for X-rays.' });
    }
  }

  // Validate File Size
  if (file.size > MAX_FILE_SIZE) {
    return res.status(422).json({ message: 'File size exceeds maximum limit of 20MB.' });
  }

  // Verify Patient exists
  const patient = await Patient.findById(patientId);
  if (!patient) {
    return res.status(404).json({ message: 'Patient not found.' });
  }

  const user = req.auth.user;

  // Determine physical storage directory
  const relativeDir = path.posix.join(
    'patients',
    String(patientId),
    'documents',
  );
  const absoluteDir = path.join(config.filesystem.storagePath, relativeDir);
  fs.mkdirSync(absoluteDir, { recursive: true });

  const cleanOriginalName = file.originalname.replace(/[^\w.-]/g, '_');
  const storedName = `${Date.now()}-${cleanOriginalName}`;
  const absoluteFilePath = path.join(absoluteDir, storedName);

  fs.writeFileSync(absoluteFilePath, file.buffer);

  const uploaderType = req.auth.guard === 'doctor' ? 'Doctor' : 'ClinicAdmin';

  const docRecord = await MedicalFile.create({
    patient_id: patientId,
    uploaded_by_id: user.id || user._id,
    uploaded_by_type: uploaderType,
    file_type: type,
    original_name: file.originalname,
    storage_path: path.posix.join(relativeDir, storedName),
    disk: config.filesystem.disk,
    mime_type: file.mimetype,
    file_size: file.size,
  });

  await auditService.logCreated(req, docRecord, 'MedicalFile');

  const uploaderName = user.name || (uploaderType === 'Doctor' ? 'Doctor' : 'Receptionist');
  const fileUrl = `/api/patients/${patientId}/documents/${docRecord.id || docRecord._id}/view`;

  return res.status(201).json({
    success: true,
    message: 'File uploaded successfully.',
    document: {
      _id: String(docRecord._id || docRecord.id),
      patientId: String(patientId),
      fileName: file.originalname,
      type,
      fileUrl,
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedBy: {
        _id: String(user.id || user._id),
        name: uploaderName,
      },
      createdAt: docRecord.created_at || new Date().toISOString(),
    },
  });
}

/**
 * List all documents for a patient.
 * GET /api/patients/:patientId/documents
 */
export async function listDocuments(req, res) {
  const { patientId } = req.params;

  const patient = await Patient.findById(patientId);
  if (!patient) {
    return res.status(404).json({ message: 'Patient not found.' });
  }

  // Fetch files from database
  const files = await MedicalFile.find({
    patient_id: patientId,
  });

  // Pre-fetch uploader details
  const formattedDocuments = await Promise.all(
    files.map(async (file) => {
      let uploaderName = 'Staff';
      if (file.uploaded_by_type === 'Doctor') {
        const uploader = await Doctor.findById(file.uploaded_by_id);
        if (uploader) uploaderName = uploader.name;
      } else if (file.uploaded_by_type === 'ClinicAdmin') {
        const uploader = await ClinicAdmin.findById(file.uploaded_by_id);
        if (uploader) uploaderName = uploader.name;
      }

      const docId = String(file._id || file.id);
      const fileType = file.file_type === 'xray' ? 'xray' : 'pdf';

      return {
        _id: docId,
        patientId: String(patientId),
        fileName: file.original_name,
        type: fileType,
        fileUrl: `/api/patients/${patientId}/documents/${docId}/view`,
        fileSize: file.file_size,
        mimeType: file.mime_type,
        uploadedBy: {
          _id: String(file.uploaded_by_id),
          name: uploaderName,
        },
        createdAt: file.created_at,
      };
    }),
  );

  return res.json(formattedDocuments);
}

/**
 * View/Stream a patient document file.
 * GET /api/patients/:patientId/documents/:documentId/view
 */
export async function viewDocument(req, res) {
  const { patientId, documentId } = req.params;

  const doc = await MedicalFile.findById(documentId);
  if (!doc) {
    return res.status(404).json({ message: 'Document not found.' });
  }

  if (String(doc.patient_id) !== String(patientId)) {
    return res.status(403).json({ message: 'You are not authorized to access this file.' });
  }

  const absolutePath = path.join(config.filesystem.storagePath, doc.storage_path);
  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ message: 'Stored file not found on disk.' });
  }

  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${doc.original_name}"`);
  return fs.createReadStream(absolutePath).pipe(res);
}

/**
 * Download a patient document file.
 * GET /api/patients/:patientId/documents/:documentId/download
 */
export async function downloadDocument(req, res) {
  const { patientId, documentId } = req.params;

  const doc = await MedicalFile.findById(documentId);
  if (!doc) {
    return res.status(404).json({ message: 'Document not found.' });
  }

  if (String(doc.patient_id) !== String(patientId)) {
    return res.status(403).json({ message: 'You are not authorized to access this file.' });
  }

  const absolutePath = path.join(config.filesystem.storagePath, doc.storage_path);
  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ message: 'Stored file not found on disk.' });
  }

  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${doc.original_name}"`);
  return fs.createReadStream(absolutePath).pipe(res);
}

/**
 * Delete a patient document.
 * DELETE /api/patients/:patientId/documents/:documentId
 */
export async function deleteDocument(req, res) {
  const { patientId, documentId } = req.params;

  const doc = await MedicalFile.findById(documentId);
  if (!doc) {
    return res.status(404).json({ message: 'Document not found.' });
  }

  if (String(doc.patient_id) !== String(patientId)) {
    return res.status(403).json({ message: 'You are not authorized to delete this file.' });
  }

  // Delete physical file from disk
  const absolutePath = path.join(config.filesystem.storagePath, doc.storage_path);
  if (fs.existsSync(absolutePath)) {
    try {
      fs.unlinkSync(absolutePath);
    } catch (err) {
      console.warn('Failed to delete physical file:', err.message);
    }
  }

  await auditService.logDeleted(req, doc, 'MedicalFile');
  await MedicalFile.delete(doc.id || doc._id);

  return res.json({ success: true, message: 'Document deleted successfully.' });
}
