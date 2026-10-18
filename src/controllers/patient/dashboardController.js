import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import {
  Appointment, Conversation, Invoice, Message,
} from '../../models/index.js';
import aiEngine from '../../services/AiEngineService.js';
import { today, whereDate } from '../../utils/helpers.js';
import { validate } from '../../utils/validate.js';
import { hydrateAppointments } from '../admin/appointmentPresenter.js';

dayjs.extend(relativeTime);

export async function index(req, res) {
  const patient = req.auth.user;

  const rawUpcoming = await Appointment.find(
    {
      patient_id: patient.id,
      appointment_date: { gte: whereDate(today()) },
      status: { in: ['pending', 'confirmed'] },
    },
    { orderBy: 'appointment_date ASC, start_time ASC', limit: 5 },
  );
  const upcomingAppointments = await hydrateAppointments(rawUpcoming);

  const rawRecent = await Appointment.find(
    {
      patient_id: patient.id,
      status: 'completed',
    },
    { orderBy: 'appointment_date DESC', limit: 5 },
  );
  const recentAppointments = await hydrateAppointments(rawRecent);

  const [totalVisits, upcoming, pendingInvoices] = await Promise.all([
    Appointment.count({ patient_id: patient.id, status: 'completed' }),
    Appointment.count({
      patient_id: patient.id,
      appointment_date: { gte: whereDate(today()) },
      status: { in: ['pending', 'confirmed'] },
    }),
    Invoice.count({ patient_id: patient.id, status: { in: ['sent', 'draft'] } }),
  ]);

  return res.json({
    patient,
    upcomingAppointments,
    recentAppointments,
    stats: {
      total_visits: totalVisits,
      upcoming,
      pending_invoices: pendingInvoices,
    },
  });
}

/** The active conversation for this patient, if one exists. */
async function activeConversation(patient) {
  return Conversation.findOne({
    patient_id: patient.id,
    status: 'active',
  });
}

export async function chat(req, res) {
  const conversation = await activeConversation(req.auth.user);

  const messages = conversation
    ? await Message.find(
      { conversation_id: conversation.id },
      { orderBy: '`created_at` ASC, `id` ASC' },
    )
    : [];

  return res.json({ messages });
}

export async function sendMessage(req, res) {
  await validate(req.body, { message: 'required|string' });

  const patient = req.auth.user;

  const conversation = await Conversation.firstOrCreate(
    { patient_id: patient.id, status: 'active' },
    {
      patient_phone: patient.phone,
      patient_name: patient.name,
      channel: 'web',
      context_memory: { turn_count: 0 },
    },
  );

  await Message.create({
    conversation_id: conversation.id,
    role: 'user',
    content: req.body.message,
  });

  const result = await aiEngine.processInput(conversation, req.body.message);

  await Message.create({
    conversation_id: conversation.id,
    role: 'assistant',
    content: result.response,
    intent: result.intent ?? null,
    entities: result.entities ?? null,
    confidence_score: result.confidence ?? null,
  });

  return res.json({
    status: 'success',
    reply: result.response,
    intent: result.intent,
  });
}

export async function getHistory(req, res) {
  const patient = req.auth.user;
  if (!patient) return res.json({ messages: [] });

  const conversation = await activeConversation(patient);

  const messages = conversation
    ? await Message.find(
      { conversation_id: conversation.id },
      { orderBy: '`created_at` ASC, `id` ASC' },
    )
    : [];

  return res.json({
    status: 'success',
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      time: dayjs(m.created_at).fromNow(),
    })),
  });
}
