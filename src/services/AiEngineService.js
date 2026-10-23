import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import {
  AiInteractionLog, Appointment, Conversation, Doctor, Patient, Treatment, WorkingHour,
} from '../models/index.js';
import notificationService from './NotificationService.js';
import { nextPatientCode } from '../controllers/auth/authController.js';
import {
  bookSlotAtomic,
  findNextAvailableSlot,
  getAvailableSlots,
  getDaySchedule,
  nowIST,
  to12h,
  toMinutes,
} from './AppointmentIntelligenceService.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kolkata';

/**
 * AI-EXT-01 to AI-EXT-06: AI Processing Pipeline
 * User Input -> Intent Detection -> Entity Extraction -> Validation -> Action -> Response
 */

/** Known intents the AI can classify. */
const INTENTS = {
  book_appointment: ['book', 'appointment', 'schedule', 'reserve', 'slot', 'book me', 'need appointment'],
  booking: ['book', 'appointment', 'schedule', 'reserve', 'slot'],
  get_daily_schedule: ['show schedule', 'my schedule', 'appointments today', 'what appointments', 'show today', 'schedule for', 'show appointments', 'list appointments', 'agenda', 'my appointments', 'how many appointments', 'booked for today', 'booked for tomorrow'],
  check_availability: ['available slots', 'free slots', 'which slots', 'what slots', 'any openings', 'open slots', 'available times', 'when can i', 'what time is available', 'availability'],
  cancellation: ['cancel', 'remove', 'delete appointment', 'not coming'],
  reschedule: ['reschedule', 'change time', 'change date', 'move appointment'],
  faq: ['hours', 'location', 'address', 'fees', 'services', 'treatment', 'cost'],
  greeting: ['hello', 'hi', 'hey', 'good morning', 'good evening'],
  status_check: ['status', 'my appointment', 'when is my', 'upcoming'],
  affirmative: ['yes', 'correct', 'yeah', 'yep', 'yup', 'sure', 'true', 'ok', 'okay', 'confirm', 'accept'],
};

/** AI-EXT-05: Medical guardrail keywords that must be blocked. */
const MEDICAL_GUARDRAIL_KEYWORDS = [
  'diagnose', 'diagnosis', 'what disease', 'am I sick', 'treatment for',
  'medicine for', 'prescribe', 'prescription', 'symptom means',
  'should I take', 'drug for', 'cure for',
];

const TREATMENT_CHOICES = [
  'Dental Checkup',
  'Cleaning & Scaling',
  'Root Canal',
  'Teeth Brightening',
  'General Consultation',
];

const SELECT_BUTTON_STYLE = 'background:#06b6d4 !important; color:#fff !important; border-radius:50px; '
  + 'padding:4px 12px; font-size:0.8rem; border:none; opacity:1 !important; visibility:visible !important; '
  + 'display:inline-block !important; pointer-events:auto;';

function treatmentPickerTable() {
  const rows = TREATMENT_CHOICES.map((treatment, index) => {
    const isLast = index === TREATMENT_CHOICES.length - 1;
    const cellStyle = isLast
      ? 'padding: 12px 16px; transition: background 0.2s;'
      : 'padding: 12px 16px; border-bottom: 1px solid #eee; transition: background 0.2s;';
    return `<tr><td class='treatment-option' data-treatment='${treatment}' style="${cellStyle}">`
      + "<div style='display:flex; justify-content:space-between; align-items:center;'>"
      + `<span style='font-weight:500;'>${treatment}</span>`
      + `<button class='btn btn-sm' style="${SELECT_BUTTON_STYLE}">Select</button>`
      + '</div></td></tr>';
  }).join('');

  return "<table class='table table-bordered table-hover mt-3' style='background: white; border-radius: 8px; "
    + 'overflow: hidden; cursor: pointer; width: 100%; border-collapse: separate; border-spacing: 0; '
    + "box-shadow: 0 2px 4px rgba(0,0,0,0.05);'>"
    + `<tbody>${rows}</tbody></table>`;
}

const MONTH_PATTERN = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?'
  + '|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

class AiEngineService {
  /** Process user input through the AI pipeline. */
  async processInput(conversation, userInput) {
    const startTime = Date.now();

    // Step 1: Safety guardrails check (AI-EXT-05)
    const guardrail = this.checkGuardrails(userInput);
    if (guardrail.triggered) {
      await this.logInteraction(conversation.id, {
        intent: 'medical_query',
        confidence_score: 1.0,
        action_taken: 'blocked',
        guardrail_triggered: true,
        guardrail_reason: guardrail.reason,
        user_input: userInput,
        ai_response: guardrail.response,
        response_time_ms: Date.now() - startTime,
      });

      return {
        response: guardrail.response,
        intent: 'medical_query',
        entities: {},
        confidence: 1.0,
        blocked: true,
      };
    }

    // Step 2: Intent Detection (AI-EXT-01)
    let intentResult = this.detectIntent(userInput);

    // Step 3: Entity Extraction (AI-EXT-02)
    const entities = this.extractEntities(userInput);

    const memory = conversation.context_memory ?? {};

    // Continuous context: preserve booking intent if user provides details or context is active
    if (
      (conversation.active_intent === 'booking' || conversation.active_intent === 'affirmative' || memory.collected_entities?.date)
      && (entities.email || entities.blood_group || entities.age || entities.name || entities.gender)
    ) {
      intentResult = { intent: 'booking', confidence: 0.95 };
    } else if (intentResult.confidence < 0.4 && conversation.active_intent) {
      intentResult = { intent: conversation.active_intent, confidence: 0.6 };
    }

    // Year confirmations — skipped during final confirmation to avoid a loop.
    if (
      intentResult.intent === 'affirmative'
      && conversation.active_intent === 'booking'
      && !memory.pending_final_confirmation
    ) {
      if (memory.collected_entities?.date) {
        memory.collected_entities.year_specified = true;
        conversation.context_memory = memory;
        await Conversation.update(conversation.id, { context_memory: memory });
        intentResult = { intent: 'booking', confidence: 0.9 };
      }
    }

    // Step 4: Update context memory (AI-EXT-03)
    await this.updateContextMemory(conversation, intentResult.intent, entities);

    // Step 5: Confidence evaluation & fallback (AI-EXT-04, AI-EXT-06)
    const { confidence } = intentResult;
    if (confidence < 0.4) {
      await this.logInteraction(conversation.id, {
        intent: intentResult.intent,
        entities,
        confidence_score: confidence,
        action_taken: 'escalation',
        guardrail_triggered: false,
        user_input: userInput,
        ai_response: 'Escalated to human agent',
        response_time_ms: Date.now() - startTime,
      });

      conversation.escalated_to_human = true;
      conversation.escalated_at = new Date();
      conversation.status = 'human_takeover';
      await Conversation.update(conversation.id, {
        escalated_to_human: 1,
        escalated_at: conversation.escalated_at,
        status: 'human_takeover',
      });

      return {
        response: "I'm not quite sure I understand. Let me connect you with our team for better assistance. A team member will be with you shortly.",
        intent: intentResult.intent,
        entities,
        confidence,
        escalated: true,
      };
    }

    // Step 6: Generate response based on intent
    const response = await this.generateResponse(intentResult.intent, entities, conversation, userInput);

    await this.logInteraction(conversation.id, {
      intent: intentResult.intent,
      entities,
      confidence_score: confidence,
      action_taken: this.mapIntentToAction(intentResult.intent),
      guardrail_triggered: false,
      user_input: userInput,
      ai_response: response,
      response_time_ms: Date.now() - startTime,
    });

    return {
      response,
      intent: intentResult.intent,
      entities,
      confidence,
      escalated: false,
    };
  }

  /** AI-EXT-05: Strict Dental Domain & Medical Guardrails */
  checkGuardrails(input) {
    const lowerInput = input.toLowerCase();

    for (const keyword of MEDICAL_GUARDRAIL_KEYWORDS) {
      if (lowerInput.includes(keyword.toLowerCase())) {
        return {
          triggered: true,
          reason: `Medical keyword detected: ${keyword}`,
          response: "I appreciate your concern about your health. However, as Dentrivo's Dental Assistant, I am not qualified to provide medical diagnoses or prescriptions. Please consult with our dentist directly for professional clinical advice. Would you like me to help you book an appointment with our dentist?",
        };
      }
    }

    const nonDentalMedical = [
      'fever', 'cough', 'cold', 'flu', 'headache', 'migraine', 'stomach', 'belly', 'abdomen',
      'nausea', 'vomit', 'diarrhea', 'cancer', 'heart', 'cardiac', 'stroke', 'diabetes',
      'insulin', 'hypertension', 'kidney', 'liver', 'lung', 'lungs', 'asthma', 'skin', 'dermatology',
      'rash', 'bone fracture', 'spine', 'backache', 'pregnancy', 'pregnant', 'baby', 'pediatric',
      'depression', 'vaccine', 'vaccination', 'covid', 'malaria', 'dengue', 'physician',
    ];
    if (nonDentalMedical.some((k) => lowerInput.includes(k))) {
      return {
        triggered: true,
        reason: 'Non-dental medical query',
        response: "I am Dentrivo's Dental Assistant. I can only assist with dental health, oral care, and dental clinic appointments. How can I help with your dental care today?",
      };
    }

    const offTopicKeywords = [
      'joke', 'jokes', 'trivia', 'quiz', 'poem', 'song', 'sing', 'movie', 'film', 'game',
      'cricket', 'football', 'weather', 'forecast', 'rain', 'temperature', 'news', 'politics',
      'president', 'minister', 'war', 'capital', 'crypto', 'bitcoin', 'stock', 'recipe',
      'cook', 'cooking', 'horoscope', 'zodiac', 'math', 'calculate', 'coding', 'python',
      'javascript', 'html', 'css', 'sql', 'homework', 'essay',
    ];
    if (offTopicKeywords.some((k) => lowerInput.includes(k))) {
      return {
        triggered: true,
        reason: 'Off-topic query',
        response: "I am Dentrivo's Dental Assistant. I can only answer dental health, oral care, and dental clinic appointment questions. How can I assist with your teeth or smile today?",
      };
    }

    return { triggered: false };
  }

  /** AI-EXT-01: Detect user intent from input. */
  detectIntent(input) {
    const lowerInput = input.toLowerCase();
    let bestMatch = 'faq';
    let bestScore = 0;

    for (const [intent, keywords] of Object.entries(INTENTS)) {
      const matchCount = keywords.filter((k) => lowerInput.includes(k)).length;
      const score = matchCount > 0 ? 0.6 + (matchCount - 1) * 0.2 : 0;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = intent;
      }
    }

    const confidence = bestScore > 0 ? Math.min(bestScore, 1.0) : 0.2;

    return { intent: bestMatch, confidence: Math.round(confidence * 10000) / 10000 };
  }

  /** AI-EXT-02: Extract entities (date, time, doctor, treatment) from input. */
  extractEntities(input) {
    const entities = {};

    const dateRegex1 = new RegExp(`\\b${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{2,4}))?\\b`, 'i');
    const dateRegex2 = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_PATTERN}(?:,?\\s*(\\d{2,4}))?\\b`, 'i');
    const numericDateRegex = /(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/;

    let match = input.match(dateRegex1);
    if (match) {
      entities.date = match[0];
      entities.year_specified = Boolean(match[2]);
    } else if ((match = input.match(dateRegex2))) {
      entities.date = match[0];
      entities.year_specified = Boolean(match[2]);
    } else if ((match = input.match(numericDateRegex))) {
      entities.date = match[0];
      entities.year_specified = Boolean(match[3]);
    }

    const relativeDate = input.match(/\b(day after tomm?or+ow|today|tomm?or+ow|tmrw|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (relativeDate) {
      let rawRef = relativeDate[1].toLowerCase().replace(/tomm+or+ow/g, 'tomorrow');
      if (rawRef === 'tmrw') rawRef = 'tomorrow';
      entities.date_reference = rawRef;
      entities.year_specified = true;
    }

    const time = input.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
      || input.match(/\b(\d{1,2})\s*:\s*(\d{2})\s*(am|pm)?\b/i);
    if (time) entities.time = time[0];

    // startAfter: "after 11 AM", "after 2:30 pm", "after 11"
    const afterMatch = input.match(/\bafter\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
    if (afterMatch) entities.startAfter = afterMatch[1].trim();

    // "next available", "earliest available", "first available"
    if (/\b(next available|earliest available|first available|any available|earliest slot|next slot)\b/i.test(input)) {
      entities.autoSelect = true;
    }

    const timePreference = input.match(/\b(morning|afternoon|evening)\b/i);
    if (timePreference) entities.time_preference = timePreference[1].toLowerCase();

    const doctor = input.match(/\b(?:dr\.?|doctor)\s+([a-zA-Z\s]+)/i);
    if (doctor) entities.doctor = doctor[1].trim();

    const treatment = input.match(/\b(checkup|cleaning|root canal|braces|extraction|whitening|scaling|consultation|implants|crown|filling|pain)\b/i);
    if (treatment) entities.treatment = treatment[1].toLowerCase();

    // Email extraction
    const emailMatch = input.match(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/);
    if (emailMatch) {
      entities.email = emailMatch[1].toLowerCase().trim();
    }

    // Blood group extraction (e.g. A+, B-, O+, AB positive, etc.)
    const bgMatch = input.match(/(?:blood\s*(?:group)?\s*[:=]?\s*)(A\+|A-|B\+|B-|O\+|O-|AB\+|AB-)(?!\w)/i)
      || input.match(/(?:\s|^|,|:)(A\+|A-|B\+|B-|O\+|O-|AB\+|AB-)(?!\w)/i)
      || input.match(/\b(A|B|AB|O)\s*(?:pos(?:itive)?|\+)(?!\w)/i)
      || input.match(/\b(A|B|AB|O)\s*(?:neg(?:ative)?|\-)(?!\w)/i);

    if (bgMatch) {
      const raw = bgMatch[0].toUpperCase();
      let val = (bgMatch[1] || bgMatch[0]).replace(/[^ABO]/gi, '').toUpperCase();
      if (raw.includes('+') || raw.includes('POS')) {
        val = `${val}+`;
      } else if (raw.includes('-') || raw.includes('NEG')) {
        val = `${val}-`;
      }
      const VALID = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
      if (VALID.includes(val)) {
        entities.blood_group = val;
      }
    }

    // Gender extraction (male, female, other)
    const genderMatch = input.match(/\b(?:gender\s*[:=]?\s*)?(male|female|other)\b/i);
    if (genderMatch) {
      entities.gender = genderMatch[1].toLowerCase();
    }

    // Age extraction (e.g. "age: 25", "25 years old", "25 yrs", "I am 25")
    const ageExplicit = input.match(/\bage\s*[:=]?\s*(\d{1,2})\b/i);
    const ageYrs = input.match(/\b(\d{1,2})\s*(?:years\s*old|yrs\s*old|years|yo)\b/i);
    const ageAm = input.match(/\b(?:i am|i'm)\s+(\d{1,2})\b/i);

    if (ageExplicit) {
      const a = Number(ageExplicit[1]);
      if (a >= 1 && a <= 120) entities.age = a;
    } else if (ageYrs) {
      const a = Number(ageYrs[1]);
      if (a >= 1 && a <= 120) entities.age = a;
    } else if (ageAm) {
      const a = Number(ageAm[1]);
      if (a >= 1 && a <= 120) entities.age = a;
    }

    // Name extraction
    const nameLabel = input.match(/(?:^|\n|,|\b)(?:my\s+name\s+is|name\s*[:=]\s*|patient(?:\s*name)?\s*[:=]\s*)([A-Za-z][A-Za-z\s]{1,30})(?:$|\n|,|;)/i);
    if (nameLabel) {
      const cand = nameLabel[1].trim();
      const forbidden = ['checkup', 'cleaning', 'consultation', 'booking', 'appointment', 'yes', 'no', 'cancel', 'tomorrow', 'today', 'male', 'female', 'other', 'here', 'doctor'];
      if (!forbidden.includes(cand.toLowerCase()) && cand.length >= 2) {
        entities.name = titleCase(cand);
      }
    } else if (input.includes(',')) {
      const firstPart = input.split(',')[0].trim();
      if (/^[A-Za-z\s]{2,30}$/.test(firstPart)) {
        const forbidden = ['yes', 'no', 'ok', 'okay', 'sure', 'male', 'female', 'other', 'tomorrow', 'today', 'checkup', 'cleaning', 'consultation', 'morning', 'afternoon'];
        if (!forbidden.includes(firstPart.toLowerCase())) {
          entities.name = titleCase(firstPart);
        }
      }
    } else if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/.test(input.trim())) {
      entities.name = titleCase(input.trim());
    }

    // Phone extraction
    const phoneMatch = input.match(/(?:\+91[\s-]?)?[6789]\d{9}/);
    if (phoneMatch) {
      entities.phone = phoneMatch[0].trim();
    }

    return entities;
  }

  /** AI-EXT-03: Update conversation context memory. */
  async updateContextMemory(conversation, intent, entities) {
    const memory = { ...(conversation.context_memory ?? {}) };
    memory.last_intent = intent;
    memory.last_entities = entities;
    memory.turn_count = (memory.turn_count ?? 0) + 1;
    memory.updated_at = new Date().toISOString();

    memory.collected_entities = { ...(memory.collected_entities ?? {}), ...entities };

    conversation.context_memory = memory;
    conversation.active_intent = intent;
    conversation.extracted_entities = memory.collected_entities;
    await Conversation.update(conversation.id, {
      context_memory: memory,
      active_intent: intent,
      extracted_entities: memory.collected_entities,
    });
  }

  /** Generate a response based on the detected intent. */
  async generateResponse(intent, entities, conversation, userInput = '') {
    switch (intent) {
      case 'book_appointment':
      case 'booking':
        return this.bookingResponse(entities, conversation, userInput);
      case 'get_daily_schedule':
        return this.scheduleResponse(entities, conversation);
      case 'check_availability':
        return this.availabilityResponse(entities, conversation);
      case 'cancellation':
        return "I can help you cancel your appointment. Could you please confirm which appointment you'd like to cancel? You can share the date or doctor's name.";
      case 'reschedule':
        return "Sure, I can help you reschedule. Please share your preferred new date and time, and I'll check availability for you.";
      case 'greeting': {
        return 'Hello! 👋 Welcome to Dentrivo Dental Clinic. How can I help you today? '
          + 'I can assist with booking appointments, checking schedules, or answering questions about our services.';
      }
      case 'status_check':
        return "Let me check your appointment status. Could you please provide your appointment date or the doctor's name?";
      case 'faq': {
        const text = (userInput || '').toLowerCase();
        if (/treatment|service|procedure|offer|provide|cost|price|fee/i.test(text)) {
          return "🦷 <strong>Our Dental Treatments & Services:</strong><br><br>"
            + "• <strong>Dental Checkup & Consultation</strong> – ₹500 (Comprehensive exam & digital X-rays)<br>"
            + "• <strong>Teeth Cleaning & Scaling</strong> – ₹1,200 (Ultrasonic plaque and tartar removal)<br>"
            + "• <strong>Painless Root Canal Therapy</strong> – ₹4,500 (Endodontic treatment to save infected teeth)<br>"
            + "• <strong>Teeth Whitening & Brightening</strong> – ₹3,000 (Cosmetic enamel stain lightening)<br>"
            + "• <strong>Dental Implants & Crowns</strong> – From ₹1,500 consultation (Permanent tooth restoration)<br>"
            + "• <strong>Orthodontics & Clear Aligners</strong> (Teeth straightening and alignment)<br>"
            + "• <strong>Tooth-Colored Composite Fillings</strong> (Cavity restoration)<br>"
            + "• <strong>Tooth Extraction & Wisdom Teeth Care</strong><br><br>"
            + "Would you like me to help you book an appointment for any of these treatments?";
        }
        if (/hour|time|open|close|timing/i.test(text)) {
          return "🕒 <strong>Dentrivo Clinic Hours:</strong><br>Monday – Friday: 9:00 AM – 5:00 PM<br>Closed on Sundays and Public Holidays.";
        }
        if (/location|address|where|direction/i.test(text)) {
          return "📍 <strong>Our Location:</strong><br>Sindhubhavan Road, Suite 400, Ahmedabad<br>📞 Phone: +31 12345-67890";
        }
        return "I'd be happy to help with your question! You can ask about our dental treatments, pricing, clinic hours, location, or book an appointment.";
      }
      case 'affirmative':
        return this.confirmationResponse(entities, conversation);
      default:
        return "I'm here to help! You can ask me about appointment booking, clinic hours, services, or any other questions. What would you like to know?";
    }
  }

  /** GET_DAILY_SCHEDULE: Show appointments for a requested date */
  async scheduleResponse(entities, conversation) {
    try {
      const memory = conversation.context_memory ?? {};
      const collected = memory.collected_entities ?? {};
      const dateRef = entities.date_reference ?? collected.date_reference ?? null;
      const dateStr = entities.date ?? collected.date ?? null;

      let resolvedDate;
      if (dateRef) {
        resolvedDate = this.resolveRelativeDateIST(dateRef);
      } else if (dateStr) {
        const parsed = this.parseDateTime(dateStr, '00:00');
        resolvedDate = parsed ? parsed.format('YYYY-MM-DD') : nowIST().format('YYYY-MM-DD');
      } else {
        resolvedDate = nowIST().format('YYYY-MM-DD');
      }

      const patientId = conversation.patient_id ?? null;
      const schedule  = await getDaySchedule(resolvedDate, { patientId });

      // Store date in context so follow-ups ("book one after 11 AM") can use it
      const newMemory = { ...memory, collected_entities: { ...collected, date: resolvedDate, date_reference: null } };
      await Conversation.update(conversation.id, { context_memory: newMemory });
      conversation.context_memory = newMemory;

      if (schedule.appointments.length === 0) {
        return `📅 <strong>Schedule for ${schedule.label}:</strong><br><br>`
          + `You have no appointments scheduled for this date.<br>`
          + `<em>Would you like to book one? Just say "Book an appointment" or "Book one after 11 AM".</em>`;
      }

      const rows = schedule.appointments.map((a, i) =>
        `<strong>${i + 1}. ${a.time12h}</strong> — <strong>${a.treatment}</strong><br>`
        + `&nbsp;&nbsp;&nbsp;👨‍⚕️ ${a.doctor_name} | `
        + `<span style="background:${statusColor(a.status)};color:#fff;padding:2px 8px;border-radius:10px;font-size:0.75rem;font-weight:600">${capitalize(a.status)}</span>`
      ).join('<br><br>');

      return `📅 <strong>Your Appointments for ${schedule.label}</strong> (${schedule.appointments.length} total):<br><br>`
        + `${rows}<br><br>`
        + `<em>Say "Book an appointment after 11 AM" or "What slots are free?" to schedule a new visit.</em>`;
    } catch (err) {
      console.error('scheduleResponse error:', err);
      return 'I had trouble fetching your schedule. Please try again.';
    }
  }

  /** CHECK_AVAILABILITY: Show free slots for a date */
  async availabilityResponse(entities, conversation) {
    try {
      const memory    = conversation.context_memory ?? {};
      const collected = memory.collected_entities ?? {};
      const dateRef   = entities.date_reference ?? collected.date_reference ?? null;
      const dateStr   = entities.date ?? collected.date ?? null;

      let resolvedDate;
      if (dateRef) {
        resolvedDate = this.resolveRelativeDateIST(dateRef);
      } else if (dateStr) {
        const parsed = this.parseDateTime(dateStr, '00:00');
        resolvedDate = parsed ? parsed.format('YYYY-MM-DD') : nowIST().format('YYYY-MM-DD');
      } else {
        resolvedDate = nowIST().format('YYYY-MM-DD');
      }

      const slots = await getAvailableSlots(resolvedDate);
      const labelDate = dayjs.tz(resolvedDate, 'YYYY-MM-DD', TZ).format('dddd, MMM D');

      if (slots.length === 0) {
        return `📅 There are <strong>no available slots</strong> on <strong>${labelDate}</strong>.<br>`
          + `Would you like me to check the next available day?`;
      }

      const slotList = slots.map((s) => {
        const [h, m] = s.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
        return `<strong>${h12}:${String(m).padStart(2,'0')} ${ampm}</strong>`;
      }).join(', ');

      return `📅 <strong>Available slots on ${labelDate}:</strong><br><br>${slotList}<br><br>`
        + `<em>To book, say something like "Book me at 11 AM" or "Book after 2 PM".</em>`;
    } catch (err) {
      console.error('availabilityResponse error:', err);
      return 'I had trouble checking availability. Please try again.';
    }
  }

  async confirmationResponse(entities, conversation) {
    const memory = { ...(conversation.context_memory ?? {}) };
    const collected = memory.collected_entities ?? {};
    const isGuest = !conversation.patient_id;

    // Safety check: When booking without login, we MUST require their details
    if (isGuest) {
      const missingGuestFields = [];
      if (!collected.name) missingGuestFields.push('Full Name');
      if (!collected.email) missingGuestFields.push('Email Address');
      if (!collected.age) missingGuestFields.push('Age');
      if (!collected.blood_group) missingGuestFields.push('Blood Group');
      if (!collected.gender) missingGuestFields.push('Gender');

      if (missingGuestFields.length > 0) {
        memory.pending_final_confirmation = false;
        conversation.context_memory = memory;
        conversation.active_intent = 'booking';
        await Conversation.update(conversation.id, {
          context_memory: memory,
          active_intent: 'booking',
        });

        const list = missingGuestFields.map((f) => `• <strong>${f}</strong>`).join('<br>');
        return `Before I can finalize your booking, please provide your personal details:<br>`
          + `${list}<br><br>`
          + '<em>Example: Name: John Doe, Email: john@example.com, Age: 28, Blood Group: O+, Gender: Male</em>';
      }
    }

    if (!memory.pending_final_confirmation) {
      return 'Got it! How else can I help you?';
    }

    const dateStr = collected.date ?? collected.date_reference ?? 'tomorrow';
    const timeStr = collected.time ?? collected.time_preference ?? '10:00';

    let requestedTime = this.parseDateTime(dateStr, timeStr);
    if (!requestedTime) {
      return "I'm sorry, I encountered a technical issue while finalizing your booking. Please try again or contact the clinic directly.";
    }
    if (requestedTime.year() < new Date().getFullYear()) {
      requestedTime = requestedTime.year(new Date().getFullYear());
    }

    const doctor = await Doctor.findOne({ is_active: 1 });
    if (!doctor) {
      return "I'm sorry, I encountered a technical issue while finalizing your booking. Please try again or contact the clinic directly.";
    }

    const treatmentName = collected.treatment ?? 'general consultation';
    const treatment = await Treatment.findOne({
      name: { like: `%${treatmentName}%` },
    });

    try {
      let patientId = conversation.patient_id;
      if (!patientId) {
        const guestName = collected.name || 'Guest Patient';
        const email = collected.email ? collected.email.toLowerCase().trim() : null;
        const phone = collected.phone || (conversation.patient_phone && !conversation.patient_phone.startsWith('guest-') ? conversation.patient_phone : null);
        const age = collected.age ? Number(collected.age) : null;
        const bloodGroup = collected.blood_group || null;
        const gender = collected.gender ? collected.gender.toLowerCase() : null;
        const currentYear = new Date().getFullYear();
        const birthYear = age ? currentYear - age : currentYear - 30;
        const dateOfBirth = `${birthYear}-01-01`;

        // Check if patient already exists by email or phone
        let existingPatient = null;
        if (email || phone) {
          const searchConds = [
            ...(email ? [{ email }] : []),
            ...(phone ? [{ phone }] : []),
          ];
          if (searchConds.length > 0) {
            existingPatient = await Patient.findOne({ or: searchConds });
          }
        }

        if (existingPatient) {
          patientId = existingPatient.id;
          await Patient.update(patientId, {
            name: guestName || existingPatient.name,
            age: age || existingPatient.age,
            blood_group: bloodGroup || existingPatient.blood_group,
            gender: gender || existingPatient.gender,
            date_of_birth: existingPatient.date_of_birth || dateOfBirth,
            ...(phone ? { phone } : {}),
          });
        } else {
          const guestPhone = phone || `+91 ${Math.floor(6000000000 + Math.random() * 3999999999)}`;
          const patientCode = await nextPatientCode();
          const newPatient = await Patient.create({
            patient_code: patientCode,
            name: guestName,
            phone: guestPhone,
            email,
            age,
            date_of_birth: dateOfBirth,
            blood_group: bloodGroup,
            gender,
            patient_type: 'new',
            is_active: 1,
          });
          patientId = newPatient.id;
        }
        await Conversation.update(conversation.id, { patient_id: patientId });
      }

      // Use bookSlotAtomic for concurrency-safe insert
      const pendingSlot = collected.pendingSlot ?? requestedTime.format('HH:mm');
      const apptDate    = collected.date ?? requestedTime.format('YYYY-MM-DD');
      let newAppointment;
      try {
        newAppointment = await bookSlotAtomic({
          patientId,
          doctorId:    doctor.id,
          treatmentId: treatment?.id ?? null,
          dateStr:     apptDate,
          startTime:   pendingSlot,
          bookedVia:   'ai_chat',
          notes:       `Automatically booked via AI Chat as ${titleCase(treatmentName)}`,
        });
      } catch (slotErr) {
        if (slotErr.code === 'SLOT_TAKEN') {
          // Try finding next free slot
          const retry = await findNextAvailableSlot(apptDate, toMinutes(pendingSlot));
          if (!retry.slot) {
            return `I'm sorry, the ${pendingSlot} slot on ${apptDate} was just taken and there are no further slots that day. Please try another date.`;
          }
          newAppointment = await bookSlotAtomic({
            patientId,
            doctorId:    doctor.id,
            treatmentId: treatment?.id ?? null,
            dateStr:     retry.isNextDay ? retry.date : apptDate,
            startTime:   retry.slot,
            bookedVia:   'ai_chat',
            notes:       `Booked via AI Chat (auto-advanced, original slot was taken)`,
          });
        } else {
          throw slotErr;
        }
      }

      try {
        const patientObj = patientId ? await Patient.findById(patientId) : null;
        await notificationService.sendTreatmentBookingEmail(newAppointment, patientObj, treatment, doctor);
      } catch (emailErr) {
        console.error('Failed to send AI chat treatment booking email:', emailErr.message);
      }

      memory.pending_final_confirmation = false;
      memory.collected_entities = {};
      conversation.context_memory = memory;
      conversation.extracted_entities = {};
      await Conversation.update(conversation.id, {
        context_memory: memory,
        extracted_entities: {},
      });

      const patientInfo = collected.name
        ? `👤 <strong>Patient:</strong> ${collected.name} (${collected.age ? `${collected.age} yrs, ` : ''}${collected.blood_group ? `${collected.blood_group}, ` : ''}${titleCase(collected.gender || '')})<br>`
        : '';
      const emailInfo = collected.email
        ? `📧 A confirmation email has been sent to <strong>${collected.email}</strong>.<br>`
        : '';

      return `Perfect! ✅ I've confirmed your appointment for ${requestedTime.format('MMM D')} `
        + `at ${requestedTime.format('h:mm A')} for ${titleCase(treatmentName)}.<br><br>`
        + patientInfo
        + emailInfo
        + 'You will receive a reminder before your visit!';
    } catch (error) {
      console.error(`BOOKING_FINAL_ERROR: ${error.message}`);
      return "I'm sorry, I encountered a technical issue while finalizing your booking. Please try again or contact the clinic directly.";
    }
  }

  async bookingResponse(entities, conversation, userInput = '') {
    const collected = conversation.context_memory?.collected_entities ?? {};

    // Merge newly extracted entities into collected
    const merged = { ...collected, ...entities };

    // --- Determine date ---
    const dateRef = merged.date_reference ?? null;
    const dateRaw = merged.date ?? null;
    let resolvedDateStr = null;
    if (dateRef) {
      resolvedDateStr = this.resolveRelativeDateIST(dateRef);
    } else if (dateRaw) {
      const p = this.parseDateTime(dateRaw, '00:00');
      resolvedDateStr = p ? p.format('YYYY-MM-DD') : null;
    }

    // If we still don't have a date, check the conversation context for a date set by schedule view
    if (!resolvedDateStr && collected.date) {
      resolvedDateStr = collected.date;
    }

    // If no date at all, ask
    if (!resolvedDateStr) {
      return `I'd love to help you book an appointment! Could you please share your preferred date? (e.g., 'tomorrow' or '${dayjs().add(1, 'day').format('MMM DD')}')`;
    }

    // --- Validate date ---
    const todayStr = nowIST().format('YYYY-MM-DD');
    if (resolvedDateStr < todayStr) {
      return `I'm sorry, I cannot book an appointment for a past date (${resolvedDateStr}). Could you please specify a future date?`;
    }
    const dow = dayjs.tz(resolvedDateStr, 'YYYY-MM-DD', TZ).day();
    if (dow === 0) {
      return `I'm sorry, but our clinic is closed on Sundays (${resolvedDateStr}). Please select another day.`;
    }

    // --- Determine slot ---
    // Priority: startAfter > autoSelect > requestedTime
    const startAfterRaw = merged.startAfter ?? null;
    const autoSelect    = merged.autoSelect ?? false;
    const reqTimeRaw    = merged.time ?? merged.time_preference ?? null;

    let afterTimeMins = null;
    let slotLabel     = '';

    if (startAfterRaw) {
      afterTimeMins = toMinutes(normalizeTimeStr(startAfterRaw));
      slotLabel = ` after ${startAfterRaw}`;
    } else if (autoSelect) {
      afterTimeMins = null;
      slotLabel = ' (earliest available)';
    } else if (reqTimeRaw) {
      // requested_time: treat as minimum (include the slot itself if available)
      const reqMins = toMinutes(normalizeTimeStr(reqTimeRaw));
      afterTimeMins = reqMins - 30; // 30 min before so the exact slot is included
      if (afterTimeMins < 0) afterTimeMins = null;
      slotLabel = ` at ${reqTimeRaw}`;
    }

    // --- Find next available slot ---
    const result = await findNextAvailableSlot(resolvedDateStr, afterTimeMins);

    if (!result.slot) {
      return `I'm sorry, there are no available slots${slotLabel} on ${formatDateFull(resolvedDateStr)}. `
        + `Would you like me to check the next available date?`;
    }

    const finalDate  = result.isNextDay ? result.date : resolvedDateStr;
    const finalSlot  = result.slot;
    const slot12h    = to12hLocal(finalSlot);
    const dateLabel  = formatDateFull(finalDate);
    const treatmentName = merged.treatment ?? collected.treatment ?? 'general consultation';
    const isGuest    = !conversation.patient_id;

    // If the slot moved to next day, inform the user
    const nextDayNote = result.isNextDay
      ? `<br><em>⚠️ No slots available${slotLabel} on ${formatDateFull(resolvedDateStr)}, so I found the next available slot on ${dateLabel}.</em>`
      : '';

    // --- Guest: require personal details ---
    if (isGuest) {
      const missingGuestFields = [];
      if (!merged.name)        missingGuestFields.push('Full Name');
      if (!merged.email)       missingGuestFields.push('Email Address');
      if (!merged.age)         missingGuestFields.push('Age');
      if (!merged.blood_group) missingGuestFields.push('Blood Group');
      if (!merged.gender)      missingGuestFields.push('Gender');

      const memory = { ...(conversation.context_memory ?? {}) };
      // Save what we know
      memory.collected_entities = {
        ...merged,
        date: finalDate,
        date_reference: null,
        pendingSlot: finalSlot,
      };
      await Conversation.update(conversation.id, { context_memory: memory });
      conversation.context_memory = memory;

      if (missingGuestFields.length > 0) {
        memory.pending_final_confirmation = false;
        await Conversation.update(conversation.id, { context_memory: memory });
        const missingListStr = missingGuestFields.map((f) => `• <strong>${f}</strong>`).join('<br>');
        return `Great! We found a slot for <strong>${titleCase(treatmentName)}</strong> on <strong>${dateLabel}</strong> at <strong>${slot12h}</strong>. 🦷${nextDayNote}<br><br>`
          + `Since you are booking without logging in, please share your details to proceed:<br>`
          + `${missingListStr}<br><br>`
          + '<em>You can reply in one message, for example:<br>'
          + 'Name: John Doe, Email: john@example.com, Age: 28, Blood Group: O+, Gender: Male</em>';
      }
    }

    // --- Show confirmation summary ---
    const memory = { ...(conversation.context_memory ?? {}) };
    memory.collected_entities = {
      ...merged,
      date: finalDate,
      date_reference: null,
      pendingSlot: finalSlot,
    };
    if (!memory.pending_final_confirmation) {
      memory.pending_final_confirmation = true;
      await Conversation.update(conversation.id, { context_memory: memory });
      conversation.context_memory = memory;

      let guestSummary = '';
      if (isGuest) {
        guestSummary = `<br>• <strong>Patient:</strong> ${merged.name} (${merged.age} yrs, ${titleCase(merged.gender ?? '')})`
          + `<br>• <strong>Blood Group:</strong> ${merged.blood_group}`
          + `<br>• <strong>Email:</strong> ${merged.email}`;
      }

      return `${nextDayNote}📋 <strong>Booking Summary:</strong><br>`
        + `• <strong>Treatment:</strong> ${titleCase(treatmentName)}<br>`
        + `• <strong>Date & Time:</strong> ${dateLabel} at ${slot12h}`
        + `${guestSummary}<br><br>`
        + 'Would you like me to confirm this booking? (Reply <strong>\'Yes\'</strong> to confirm)';
    }

    return "Great! I'm ready when you are. Just say 'Yes' to confirm.";
  }

  /** Resolve a relative date string to YYYY-MM-DD using IST timezone */
  resolveRelativeDateIST(dateRef) {
    let lower = (dateRef ?? '').toLowerCase().replace(/tomm+or+ow/g, 'tomorrow');
    if (lower === 'tmrw') lower = 'tomorrow';
    const now = nowIST().startOf('day');

    if (lower === 'today') return now.format('YYYY-MM-DD');
    if (lower === 'day after tomorrow') return now.add(2, 'day').format('YYYY-MM-DD');
    if (lower === 'tomorrow') return now.add(1, 'day').format('YYYY-MM-DD');
    if (lower === 'next week') return now.add(7, 'day').format('YYYY-MM-DD');

    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const wIdx = weekdays.indexOf(lower);
    if (wIdx !== -1) {
      let c = now.day(wIdx);
      if (!c.isAfter(now)) c = c.add(7, 'day');
      return c.format('YYYY-MM-DD');
    }

    return now.format('YYYY-MM-DD'); // fallback to today
  }

  parseDateTime(dateStr, timeStr) {
    const base = this.resolveRelativeDate(String(dateStr ?? '').trim());
    if (!base) return null;

    const time = this.resolveTime(String(timeStr ?? '').trim());
    return base.hour(time.hour).minute(time.minute).second(0).millisecond(0);
  }

  resolveRelativeDate(value) {
    let lower = String(value ?? '').toLowerCase().replace(/tomm+or+ow/g, 'tomorrow');
    if (lower === 'tmrw') lower = 'tomorrow';
    const now = dayjs().tz(TZ).startOf('day');

    if (lower === 'today') return now;
    if (lower === 'day after tomorrow') return now.add(2, 'day');
    if (lower === 'tomorrow') return now.add(1, 'day');
    if (lower === 'next week') return now.add(7, 'day');

    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const weekdayIndex = weekdays.indexOf(lower);
    if (weekdayIndex !== -1) {
      let candidate = now.day(weekdayIndex);
      if (!candidate.isAfter(now)) candidate = candidate.add(7, 'day');
      return candidate;
    }

    const FORMATS = [
      'MMM D YYYY', 'MMMM D YYYY', 'MMM D', 'MMMM D',
      'D MMM YYYY', 'D MMMM YYYY', 'D MMM', 'D MMMM',
      'D/M/YYYY', 'D/M/YY', 'D/M', 'D-M-YYYY', 'D-M-YY', 'D-M',
      'YYYY-MM-DD',
    ];
    const cleaned = value.replace(/(\d+)(st|nd|rd|th)/gi, '$1').replace(/,/g, '').trim();
    for (const format of FORMATS) {
      const parsed = dayjs(cleaned, format, true);
      if (parsed.isValid()) {
        return format.includes('YY') ? parsed.startOf('day') : parsed.year(dayjs().year()).startOf('day');
      }
    }

    const loose = dayjs(cleaned);
    return loose.isValid() ? loose.startOf('day') : null;
  }

  resolveTime(value) {
    const lower = value.toLowerCase();
    if (lower === 'morning') return { hour: 10, minute: 0 };
    if (lower === 'afternoon') return { hour: 14, minute: 0 };
    if (lower === 'evening') return { hour: 17, minute: 0 };

    const match = lower.match(/(\d{1,2})\s*:?\s*(\d{2})?\s*(am|pm)?/);
    if (!match) return { hour: 10, minute: 0 };

    let hour = Number(match[1]);
    const minute = Number(match[2] ?? 0);
    const meridiem = match[3];

    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;

    return { hour, minute };
  }

  mapIntentToAction(intent) {
    switch (intent) {
      case 'booking': return 'booking';
      case 'cancellation': return 'cancellation';
      case 'faq': return 'faq';
      default: return 'other';
    }
  }

  async logInteraction(conversationId, data) {
    try {
      await AiInteractionLog.create({
        conversation_id: conversationId,
        ...data,
      });
    } catch (error) {
      console.error('Failed to log AI interaction', error.message);
    }
  }
}

function titleCase(value) {
  return String(value).replace(/\b\w/g, (c) => c.toUpperCase());
}

function to12hLocal(timeStr) {
  return to12h(timeStr);
}

function formatDateFull(dateStr) {
  return dayjs.tz(dateStr, 'YYYY-MM-DD', TZ).format('MMMM D, YYYY');
}

function statusColor(status) {
  switch (String(status).toLowerCase()) {
    case 'confirmed': return '#10b981';
    case 'completed': return '#3b82f6';
    case 'cancelled': return '#ef4444';
    case 'pending':
    default: return '#f59e0b';
  }
}

function capitalize(value) {
  if (!value) return '';
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

export default new AiEngineService();
