/**
 * Default Seed & Fallback Data for Dentrivo Dynamic CMS Content.
 */

export const DEFAULT_SERVICES = [
  {
    title: 'AI-Powered Diagnosis',
    slug: 'ai-powered-diagnosis',
    short_description: 'Advanced AI technology for accurate and efficient dental diagnosis and treatment planning.',
    full_description: 'Leveraging state-of-the-art computer vision and dental intelligence to detect anomalies, analyze radiographs, and provide predictive care recommendations.',
    icon: 'bi-robot',
    image: '',
    button_text: 'Schedule AI Scan',
    button_link: '#book',
    is_active: true,
    display_order: 1,
  },
  {
    title: 'Easy Appointments',
    slug: 'easy-appointments',
    short_description: 'Book appointments in seconds using our online form or chat directly with our AI Chatbot to reserve your slot.',
    full_description: 'Real-time calendar synchronization, instant SMS/Email notifications, and zero-wait doctor scheduling suited to your availability.',
    icon: 'bi-calendar-check',
    image: '',
    button_text: 'Book Slot',
    button_link: '#book',
    is_active: true,
    display_order: 2,
  },
  {
    title: 'Preventive Care',
    slug: 'preventive-care',
    short_description: 'Regular check-ups and cleanings to maintain optimal oral health and prevent issues before they begin.',
    full_description: 'Comprehensive dental hygiene routines, ultrasonic scaling, fluoride treatments, and personalized prevention plans for lifelong healthy teeth.',
    icon: 'bi-heart-pulse',
    image: '',
    button_text: 'Learn More',
    button_link: '#book',
    is_active: true,
    display_order: 3,
  },
  {
    title: 'Restorative Treatments',
    slug: 'restorative-treatments',
    short_description: 'Fillings, crowns, bridges, and more to restore your smile to its natural beauty, durability, and strength.',
    full_description: 'Biocompatible composite resins, porcelain crowns, and minimally invasive techniques designed to restore damaged or decayed teeth comfortably.',
    icon: 'bi-gear',
    image: '',
    button_text: 'Explore Options',
    button_link: '#book',
    is_active: true,
    display_order: 4,
  },
  {
    title: 'Cosmetic Dentistry',
    slug: 'cosmetic-dentistry',
    short_description: 'Teeth whitening, veneers, and smile makeovers to enhance your confidence with radiant aesthetics.',
    full_description: 'Professional laser teeth whitening, custom porcelain veneers, orthodontic alignment, and aesthetic tooth reshaping.',
    icon: 'bi-stars',
    image: '',
    button_text: 'View Treatments',
    button_link: '#book',
    is_active: true,
    display_order: 5,
  },
  {
    title: '24/7 AI Chatbot & Booking',
    slug: '24-7-ai-chatbot-booking',
    short_description: 'Get instant answers and book or reschedule your dental visits directly through conversational AI chat.',
    full_description: 'Our conversational AI dental receptionist answers clinic FAQs, provides emergency triage guidance, and locks in appointments 24 hours a day.',
    icon: 'bi-chat-dots',
    image: '',
    button_text: 'Start Chat',
    button_link: '#chat',
    is_active: true,
    display_order: 6,
  },
];

export const DEFAULT_WHY_CHOOSE_US = [
  {
    number: '15+',
    title: 'Years Experience',
    description: 'Trusted by thousands of patients across decades of practice.',
    icon: 'bi-award',
    image: '',
    is_active: true,
    display_order: 1,
  },
  {
    number: '10k+',
    title: 'Happy Patients',
    description: 'Satisfied smiles and radiant results across the entire city.',
    icon: 'bi-emoji-smile',
    image: '',
    is_active: true,
    display_order: 2,
  },
  {
    number: '5',
    title: 'Expert Doctors',
    description: 'Highly qualified specialists and maxillofacial surgeons.',
    icon: 'bi-person-badge',
    image: '',
    is_active: true,
    display_order: 3,
  },
  {
    number: '24/7',
    title: 'Support',
    description: 'Always here for you with intelligent automated assistance.',
    icon: 'bi-headset',
    image: '',
    is_active: true,
    display_order: 4,
  },
];

export const DEFAULT_PRIVACY_POLICY = {
  page_title: 'Privacy Policy',
  introduction: 'Your medical and dental privacy is our highest priority. Learn how Dentrivo safeguards your personal details, clinical records, and AI chatbot communications.',
  pledge_title: 'Our Patient Privacy Pledge',
  pledge_content: 'Dentrivo will <strong>never</strong> sell, rent, or monetize your health information, dental treatment history, or chat transcripts to third-party advertisers. All clinical information is processed strictly to provide quality dental care, coordinate appointments, and manage clinic operations.',
  sections: [
    {
      id: 'sec-1',
      heading: '1. Information We Collect',
      content: `<p>To provide seamless clinic operations and intelligent scheduling, we collect:</p>
<ul>
  <li><strong>Personal Identity Details:</strong> Full name, age, date of birth, gender, blood group, and contact information (email address and phone number).</li>
  <li><strong>Appointment &amp; Clinical Data:</strong> Requested treatments (e.g. Scaling, Root Canal, Whitening), attending dentist, appointment date, time slots, and status history.</li>
  <li><strong>AI Chatbot Conversations:</strong> Inquiries sent to our AI assistant to schedule appointments, answer clinic queries, or evaluate slot availability.</li>
  <li><strong>Technical Data:</strong> Browser type, IP address, and cookie tokens strictly necessary for session security and CSRF defense.</li>
</ul>`,
      display_order: 1,
    },
    {
      id: 'sec-2',
      heading: '2. How We Use Your Information',
      content: `<p>We utilize patient data for strictly legitimate healthcare and operational goals:</p>
<ul>
  <li>Scheduling, confirming, or updating your dental appointments in real time.</li>
  <li>Transmitting automated booking confirmation receipts and treatment reminders.</li>
  <li>Enabling our AI Chatbot to find the best available slot suited to your requests.</li>
  <li>Maintaining doctor patient records and treatment history securely in our portal.</li>
</ul>`,
      display_order: 2,
    },
    {
      id: 'sec-3',
      heading: '3. Data Security & Encryption',
      content: `<p>We implement industry-standard administrative, physical, and technical safeguards:</p>
<ul>
  <li>All data transmitted between your browser and our servers is secured via <strong>TLS/HTTPS 256-bit encryption</strong>.</li>
  <li>User passwords and authentication tokens are salted and hashed using bcrypt.</li>
  <li>Database records in MongoDB Atlas are encrypted at rest with strict IP whitelisting and role-based access control.</li>
</ul>`,
      display_order: 3,
    },
    {
      id: 'sec-4',
      heading: '4. Your Rights as a Patient',
      content: `<p>You have the full right to:</p>
<ul>
  <li>Access and review your personal profile and appointment history anytime through the Patient Portal.</li>
  <li>Request corrections to any inaccurate contact information or medical records.</li>
  <li>Clear your ongoing AI chatbot session history via the chat widget options.</li>
  <li>Request complete account deactivation and removal subject to medical record retention laws.</li>
</ul>`,
      display_order: 4,
    },
    {
      id: 'sec-5',
      heading: '5. Privacy Inquiries',
      content: `<p>For any privacy inquiries or to exercise your data rights, contact our Data Protection Officer:</p>
<div class="p-3 bg-light rounded-3" style="font-size:0.95rem;">
  <p class="mb-1"><strong>Dentrivo Privacy &amp; Compliance Office</strong></p>
  <p class="mb-1 text-secondary">Sindhubhavan Road, Suite 400, Ahmedabad, Gujarat, India</p>
  <p class="mb-0 text-secondary">Email: <a href="mailto:privacy@dentalai.com" class="text-decoration-none text-info fw-semibold">privacy@dentalai.com</a> • Phone: +31 12345-67890</p>
</div>`,
      display_order: 5,
    },
  ],
  effective_date: '2026-01-01',
  last_updated: 'October 2026',
  status: 'published',
};

export const DEFAULT_COOKIE_POLICY = {
  page_title: 'Cookie Policy',
  introduction: 'Understand how Dentrivo uses cookies and local storage technologies to ensure secure authentication, remember clinic preferences, and facilitate AI chat.',
  sections: [
    {
      id: 'sec-1',
      heading: '1. What Are Cookies?',
      content: `<p>Cookies are small text files placed on your computer or mobile device when you visit websites. They are widely used to make websites work efficiently, secure user logins, and provide essential data to clinic systems.</p>`,
      display_order: 1,
    },
    {
      id: 'sec-2',
      heading: '2. Cookies We Utilize',
      content: `<p>Dentrivo uses a minimal set of cookies designed purely for performance and functionality:</p>
<div class="table-responsive mt-3">
  <table class="table table-bordered align-middle">
    <thead class="table-light">
      <tr>
        <th style="width:25%;">Category</th>
        <th style="width:45%;">Purpose</th>
        <th style="width:30%;">Expiry</th>
      </tr>
    </thead>
    <tbody style="font-size:0.92rem;">
      <tr>
        <td class="fw-bold text-primary">Strictly Essential</td>
        <td>Secure JWT authentication tokens and session identifiers ensuring patient, doctor, and admin portal security.</td>
        <td>Session / 30 days (Remember Me)</td>
      </tr>
      <tr>
        <td class="fw-bold text-info">Functionality</td>
        <td>Local storage caching for clinic contact details and active chatbot session IDs to avoid repeated roundtrips.</td>
        <td>Persistent (Local Storage)</td>
      </tr>
      <tr>
        <td class="fw-bold text-success">Security &amp; CSRF</td>
        <td>Protects appointment booking forms and API requests against Cross-Site Request Forgery attacks.</td>
        <td>Session duration</td>
      </tr>
    </tbody>
  </table>
</div>`,
      display_order: 2,
    },
    {
      id: 'sec-3',
      heading: '3. Third-Party Cookies',
      content: `<p>Dentrivo does <strong>not</strong> employ third-party tracking pixels, cross-site advertising cookies, or behavioral tracking tools. Any third-party integrations (e.g. Razorpay payment gateways or secure email SMTP triggers) operate under their respective strict security protocols during transaction authorization.</p>`,
      display_order: 3,
    },
    {
      id: 'sec-4',
      heading: '4. Managing Your Cookie Preferences',
      content: `<p>You have the option to accept or decline cookies via your web browser settings. Most browsers allow you to inspect, manage, and delete stored cookies. Please note that disabling strictly essential cookies may prevent you from logging into your patient dashboard or booking appointments.</p>`,
      display_order: 4,
    },
    {
      id: 'sec-5',
      heading: '5. Contact Us',
      content: `<p>If you have questions about our cookie usage or data practices, contact us at:</p>
<div class="p-3 bg-light rounded-3" style="font-size:0.95rem;">
  <p class="mb-1"><strong>Dentrivo Dental Clinic</strong></p>
  <p class="mb-0 text-secondary">Email: <a href="mailto:info@dentalai.com" class="text-decoration-none text-info fw-semibold">info@dentalai.com</a> • Phone: +31 12345-67890</p>
</div>`,
      display_order: 5,
    },
  ],
  effective_date: '2026-01-01',
  last_updated: 'October 2026',
  status: 'published',
};
