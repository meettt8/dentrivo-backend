import {
  Appointment, Doctor, Patient, Treatment,
} from '../../models/index.js';

/**
 * Turn raw appointment documents into the nested shape the React pages read:
 * `patient_id`, `doctor_id` and `treatment_id` hold populated objects.
 */
export async function hydrateAppointments(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const patientIds = [...new Set(rows.map((r) => (typeof r.patient_id === 'object' ? r.patient_id?.id : r.patient_id)).filter(Boolean))];
  const doctorIds = [...new Set(rows.map((r) => (typeof r.doctor_id === 'object' ? r.doctor_id?.id : r.doctor_id)).filter(Boolean))];
  const treatmentIds = [...new Set(rows.map((r) => (typeof r.treatment_id === 'object' ? r.treatment_id?.id : r.treatment_id)).filter(Boolean))];

  const [patients, doctors, treatments] = await Promise.all([
    patientIds.length ? Patient.find({ id: { in: patientIds } }, { withTrashed: true }) : [],
    doctorIds.length ? Doctor.find({ id: { in: doctorIds } }) : [],
    treatmentIds.length ? Treatment.find({ id: { in: treatmentIds } }) : [],
  ]);

  const patientMap = new Map(patients.map((p) => [String(p.id), p]));
  const doctorMap = new Map(doctors.map((d) => [String(d.id), d]));
  const treatmentMap = new Map(treatments.map((t) => [String(t.id), t]));

  return rows.map((row) => {
    const appointment = Appointment.present(row);

    const rawPatientId = typeof row.patient_id === 'object' ? row.patient_id?.id : row.patient_id;
    const patient = rawPatientId ? patientMap.get(String(rawPatientId)) : null;

    appointment.patient_id = patient ? {
      id: patient.id,
      name: patient.name,
      phone: patient.phone,
      email: patient.email,
      patient_code: patient.patient_code,
      avatar_url: `https://ui-avatars.com/api/?name=${encodeURIComponent(patient.name ?? '')}&background=6366F1&color=fff`,
    } : (row.patient_id && typeof row.patient_id === 'object' ? row.patient_id : null);

    const rawDoctorId = typeof row.doctor_id === 'object' ? row.doctor_id?.id : row.doctor_id;
    const doctor = rawDoctorId ? doctorMap.get(String(rawDoctorId)) : null;

    appointment.doctor_id = doctor ? {
      id: doctor.id,
      name: doctor.name,
      specialisation: doctor.specialisation,
      avatar_url: doctor.avatar
        ? `/storage/${doctor.avatar}`
        : `https://ui-avatars.com/api/?name=${encodeURIComponent(doctor.name ?? '')}&background=10B981&color=fff`,
    } : (row.doctor_id && typeof row.doctor_id === 'object' ? row.doctor_id : null);

    const rawTreatmentId = typeof row.treatment_id === 'object' ? row.treatment_id?.id : row.treatment_id;
    const treatment = rawTreatmentId ? treatmentMap.get(String(rawTreatmentId)) : null;

    appointment.treatment_id = treatment ? {
      id: treatment.id,
      name: treatment.name,
      duration_mins: treatment.duration_mins,
    } : (row.treatment_id && typeof row.treatment_id === 'object' ? row.treatment_id : null);

    return appointment;
  });
}
