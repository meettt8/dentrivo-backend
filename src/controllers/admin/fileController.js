import fs from 'node:fs';
import path from 'node:path';
import config from '../../config/index.js';
import { MedicalFile, Patient } from '../../models/index.js';
import auditService from '../../services/AuditService.js';
import { abort } from '../../utils/http.js';
import { validate } from '../../utils/validate.js';

/** FILE-01 to FILE-04: Admin File Management. */

const PREVIEWABLE_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
];

export function isPreviewable(file) {
  return PREVIEWABLE_MIME_TYPES.includes(file.mime_type);
}

/** FILE-01: Upload medical files (X-rays, prescriptions, etc.). */
export async function upload(req, res) {
  await validate(
    { ...req.body, file: req.file },
    {
      patient_id: 'required|exists:Patient,id',
      file: 'required|file',
      file_type: 'required|in:xray,prescription,lab_report,consent_form,insurance_doc,other',
      description: 'nullable|string|max:255',
    },
    { Patient },
  );

  const admin = req.auth.user;
  const file = req.file;

  const relativeDir = path.posix.join(
    'patients', String(req.body.patient_id), 'files',
  );
  const absoluteDir = path.join(config.filesystem.storagePath, relativeDir);
  fs.mkdirSync(absoluteDir, { recursive: true });

  const storedName = `${Date.now()}-${file.originalname.replace(/[^\w.-]/g, '_')}`;
  fs.writeFileSync(path.join(absoluteDir, storedName), file.buffer);

  const medicalFile = await MedicalFile.create({
    patient_id: req.body.patient_id,
    appointment_id: req.body.appointment_id || null,
    uploaded_by_id: admin.id,
    uploaded_by_type: 'ClinicAdmin',
    file_type: req.body.file_type,
    original_name: file.originalname,
    storage_path: path.posix.join(relativeDir, storedName),
    disk: config.filesystem.disk,
    mime_type: file.mimetype,
    file_size: file.size,
    description: req.body.description ?? null,
  });

  await auditService.logCreated(req, medicalFile, 'MedicalFile');

  return res.status(201).json({
    success: true,
    message: 'File uploaded successfully.',
    file: medicalFile,
  });
}

/** FILE-04: Preview a file in the browser. */
export async function preview(req, res) {
  const file = await MedicalFile.findById(req.params.id);
  if (!file) abort(404, 'File not found.');

  if (!isPreviewable(file)) {
    return res.status(422).json({ error: 'This file type cannot be previewed.' });
  }

  return streamFile(res, file);
}

/** Delete a file (soft delete). */
export async function destroy(req, res) {
  const file = await MedicalFile.findById(req.params.id);
  if (!file) abort(404, 'File not found.');

  await auditService.logDeleted(req, file, 'MedicalFile');
  await MedicalFile.delete(file.id);

  return res.json({ success: true, message: 'File deleted successfully.' });
}

export function streamFile(res, file, { download = false } = {}) {
  const absolutePath = path.join(config.filesystem.storagePath, file.storage_path);

  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ message: 'Unable to locate the stored file.' });
  }

  res.setHeader('Content-Type', file.mime_type ?? 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${file.original_name}"`,
  );

  return fs.createReadStream(absolutePath).pipe(res);
}
