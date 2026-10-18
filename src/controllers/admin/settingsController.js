import {
  Clinic, Treatment, WorkingHour,
} from '../../models/index.js';
import { getDb } from '../../config/db.js';
import { abort } from '../../utils/http.js';
import { validate } from '../../utils/validate.js';

export async function index(req, res) {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  const db = getDb();
  const [treatments, hours, rawClinic] = await Promise.all([
    Treatment.find({}, { orderBy: '`id` ASC' }),
    WorkingHour.find({}, { orderBy: '`doctor_id` ASC, `day_of_week` ASC' }),
    db.collection('clinics').findOne({}),
  ]);

  const clinic = rawClinic ? Clinic.present(rawClinic) : {
    name: 'Dentrivo Dental Clinic',
    email: 'info@dentalai.com',
    phone: '+31 12345-67890',
    address: '123 Health Care Ave, Suite 400',
    city: 'Ahmedabad',
    state: 'Gujarat',
    country: 'IN',
    timezone: 'Asia/Kolkata',
  };

  const workingHours = {};
  for (const hour of hours) {
    const key = String(hour.doctor_id);
    workingHours[key] ??= [];
    workingHours[key].push(hour);
  }

  return res.json({ clinic, treatments, workingHours });
}

export async function updateClinic(req, res) {
  await validate(req.body, {
    name: 'required',
    phone: 'required',
    email: 'required|email',
  });

  const clinicData = {
    name: (req.body.name || '').trim(),
    email: (req.body.email || '').trim(),
    phone: (req.body.phone || '').trim(),
    address: (req.body.address || '').trim() || '123 Health Care Ave, Suite 400',
    city: (req.body.city || '').trim() || 'Ahmedabad',
    state: (req.body.state || '').trim() || 'Gujarat',
    country: (req.body.country || '').trim() || 'IN',
    timezone: (req.body.timezone || '').trim() || 'Asia/Kolkata',
  };

  const db = getDb();
  const existing = await db.collection('clinics').findOne({});
  let clinic;
  if (existing) {
    await db.collection('clinics').updateOne(
      { _id: existing._id },
      { $set: { ...clinicData, updated_at: new Date() } },
    );
    const updatedDoc = await db.collection('clinics').findOne({ _id: existing._id });
    clinic = Clinic.present(updatedDoc);
  } else {
    const insertRes = await db.collection('clinics').insertOne({
      ...clinicData,
      created_at: new Date(),
      updated_at: new Date(),
    });
    clinic = Clinic.present({ ...clinicData, _id: insertRes.insertedId, id: String(insertRes.insertedId) });
  }

  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.json({ success: true, message: 'Clinic contact & profile updated successfully.', clinic });
}

const TREATMENT_COLUMNS = ['name', 'description', 'duration_mins', 'default_price', 'category', 'is_active'];

function treatmentFields(body) {
  const out = {};
  for (const column of TREATMENT_COLUMNS) {
    if (body[column] !== undefined) out[column] = body[column] === '' ? null : body[column];
  }
  return out;
}

export async function storeTreatment(req, res) {
  await validate(req.body, {
    name: 'required',
    duration_mins: 'required|integer|min:5',
    default_price: 'required|numeric|min:0',
  });

  const fields = treatmentFields(req.body);
  if (fields.default_price !== undefined && fields.default_price !== null) {
    fields.default_price = Number(fields.default_price);
  }
  if (fields.duration_mins !== undefined && fields.duration_mins !== null) {
    fields.duration_mins = Number(fields.duration_mins);
  }

  const treatment = await Treatment.create({
    ...fields,
    is_active: fields.is_active ?? true,
  });

  return res.status(201).json({ success: true, message: 'Treatment added successfully.', treatment });
}

export async function updateTreatment(req, res) {
  await validate(req.body, {
    default_price: 'sometimes|numeric|min:0',
    duration_mins: 'sometimes|integer|min:5',
    name: 'sometimes|string',
  });

  const treatment = await Treatment.findById(req.params.id);
  if (!treatment) abort(404, 'Treatment not found.');

  const fields = treatmentFields(req.body);
  if (fields.default_price !== undefined && fields.default_price !== null) {
    fields.default_price = Number(fields.default_price);
  }
  if (fields.duration_mins !== undefined && fields.duration_mins !== null) {
    fields.duration_mins = Number(fields.duration_mins);
  }
  if (fields.is_active !== undefined) {
    fields.is_active = Boolean(fields.is_active === true || fields.is_active === 1 || fields.is_active === '1');
  }

  const db = getDb();
  await db.collection('treatments').updateOne(
    { $or: [{ _id: treatment._id }, { id: String(treatment.id) }] },
    { $set: { ...fields, updated_at: new Date() } },
  );

  const updated = await Treatment.findById(treatment.id);
  return res.json({ success: true, message: 'Treatment price and details updated successfully.', treatment: updated });
}
