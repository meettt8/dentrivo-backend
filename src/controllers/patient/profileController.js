import { Patient } from '../../models/index.js';
import { checkPassword, hashPassword } from '../../utils/auth.js';
import { ValidationError } from '../../utils/http.js';
import { validate } from '../../utils/validate.js';

const EDITABLE_FIELDS = [
  'name', 'phone', 'email', 'avatar', 'address', 'city', 'date_of_birth', 'gender',
  'blood_group', 'allergies', 'medical_notes',
  'emergency_contact_name', 'emergency_contact_phone',
];

export async function index(req, res) {
  const patient = await Patient.findById(req.auth.user.id, { keepHidden: ['password'] });
  return res.json({ patient: patient || req.auth.user });
}

export async function update(req, res) {
  const patient = await Patient.findById(req.auth.user.id, { keepHidden: ['password'] });

  if (!patient) {
    throw new ValidationError({ general: ['Patient account not found.'] });
  }

  await validate(req.body, {
    name: 'required|string',
    phone: 'required|string',
    // `unique:patients,email,{id}` — ignore this patient's own row.
    email: `required|email|unique:Patient,email,${patient.id}`,
    avatar: 'nullable|string',
    address: 'nullable|string',
    city: 'nullable|string',
    date_of_birth: 'nullable|string',
    gender: 'nullable|string',
    blood_group: 'nullable|string',
    allergies: 'nullable|string',
    medical_notes: 'nullable|string',
    emergency_contact_name: 'nullable|string',
    emergency_contact_phone: 'nullable|string',
  }, { Patient });

  const changes = {};
  for (const field of EDITABLE_FIELDS) {
    if (req.body[field] !== undefined) {
      changes[field] = req.body[field] === '' ? null : req.body[field];
    }
  }

  if (req.body.password) {
    await validate(req.body, {
      password: 'min:6|confirmed',
      current_password: 'required',
    });

    if (!(await checkPassword(req.body.current_password, patient.password))) {
      throw new ValidationError({ current_password: ['Current password incorrect.'] });
    }

    changes.password = await hashPassword(req.body.password);
  }

  const updated = await Patient.update(patient.id, changes);

  return res.json({
    success: true,
    message: 'Profile updated successfully.',
    patient: updated,
  });
}
