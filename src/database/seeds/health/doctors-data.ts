/**
 * Demo Healthcare data: 30 FICTIONAL doctors (no real people, no real
 * hospitals, PMDC numbers prefixed DEMO-) across 12 specialties in Lahore,
 * Karachi and Islamabad. Everything else (hours, fees, qualifications,
 * reviews) is generated deterministically from these rows in seed-health.ts.
 */

export type Gender = 'male' | 'female';
export type City = 'Lahore' | 'Karachi' | 'Islamabad';

export interface DemoDoctor {
  key: string;
  title: 'dr' | 'prof' | 'assoc_prof' | 'asst_prof';
  name: string;
  gender: Gender;
  specialty: string;
  city: City;
  since: number;
  /** Extra languages after English and Urdu. */
  languages?: string[];
  /** Clinics (1–3) and whether a video consultation is offered. */
  clinics: 1 | 2 | 3;
  video: boolean;
}

export const DEMO_DOCTORS: DemoDoctor[] = [
  {
    key: 'dr01',
    title: 'dr',
    name: 'Sana Iqbal',
    gender: 'female',
    specialty: 'dermatologist',
    city: 'Lahore',
    since: 2011,
    languages: ['Punjabi'],
    clinics: 2,
    video: true,
  },
  {
    key: 'dr02',
    title: 'asst_prof',
    name: 'Hamza Qureshi',
    gender: 'male',
    specialty: 'dermatologist',
    city: 'Karachi',
    since: 2009,
    clinics: 1,
    video: true,
  },
  {
    key: 'dr03',
    title: 'dr',
    name: 'Mehwish Tariq',
    gender: 'female',
    specialty: 'dermatologist',
    city: 'Lahore',
    since: 2016,
    clinics: 1,
    video: false,
  },
  {
    key: 'dr04',
    title: 'dr',
    name: 'Usman Farooq',
    gender: 'male',
    specialty: 'general-physician',
    city: 'Lahore',
    since: 2014,
    languages: ['Punjabi'],
    clinics: 2,
    video: true,
  },
  {
    key: 'dr05',
    title: 'dr',
    name: 'Ayesha Siddiqui',
    gender: 'female',
    specialty: 'general-physician',
    city: 'Karachi',
    since: 2018,
    languages: ['Sindhi'],
    clinics: 1,
    video: true,
  },
  {
    key: 'dr06',
    title: 'dr',
    name: 'Bilal Ahmed',
    gender: 'male',
    specialty: 'general-physician',
    city: 'Islamabad',
    since: 2012,
    languages: ['Pashto'],
    clinics: 1,
    video: false,
  },
  {
    key: 'dr07',
    title: 'dr',
    name: 'Rabia Nadeem',
    gender: 'female',
    specialty: 'general-physician',
    city: 'Lahore',
    since: 2020,
    clinics: 1,
    video: true,
  },
  {
    key: 'dr08',
    title: 'prof',
    name: 'Nasreen Akhtar',
    gender: 'female',
    specialty: 'gynecologist',
    city: 'Lahore',
    since: 1998,
    languages: ['Punjabi'],
    clinics: 3,
    video: false,
  },
  {
    key: 'dr09',
    title: 'dr',
    name: 'Fatima Zaidi',
    gender: 'female',
    specialty: 'gynecologist',
    city: 'Karachi',
    since: 2010,
    clinics: 2,
    video: true,
  },
  {
    key: 'dr10',
    title: 'assoc_prof',
    name: 'Saima Rehman',
    gender: 'female',
    specialty: 'gynecologist',
    city: 'Islamabad',
    since: 2005,
    clinics: 1,
    video: true,
  },
  {
    key: 'dr11',
    title: 'dr',
    name: 'Imran Shah',
    gender: 'male',
    specialty: 'pediatrician',
    city: 'Lahore',
    since: 2008,
    clinics: 2,
    video: false,
  },
  {
    key: 'dr12',
    title: 'dr',
    name: 'Hina Baig',
    gender: 'female',
    specialty: 'pediatrician',
    city: 'Karachi',
    since: 2015,
    clinics: 1,
    video: true,
  },
  {
    key: 'dr13',
    title: 'asst_prof',
    name: 'Kamran Malik',
    gender: 'male',
    specialty: 'pediatrician',
    city: 'Islamabad',
    since: 2011,
    languages: ['Punjabi'],
    clinics: 1,
    video: false,
  },
  {
    key: 'dr14',
    title: 'dr',
    name: 'Zainab Hassan',
    gender: 'female',
    specialty: 'psychiatrist',
    city: 'Lahore',
    since: 2013,
    clinics: 1,
    video: true,
  },
  {
    key: 'dr15',
    title: 'dr',
    name: 'Faisal Raza',
    gender: 'male',
    specialty: 'psychiatrist',
    city: 'Karachi',
    since: 2007,
    clinics: 1,
    video: true,
  },
  {
    key: 'dr16',
    title: 'prof',
    name: 'Tariq Mehmood',
    gender: 'male',
    specialty: 'cardiologist',
    city: 'Lahore',
    since: 1995,
    languages: ['Punjabi'],
    clinics: 2,
    video: false,
  },
  {
    key: 'dr17',
    title: 'dr',
    name: 'Sadia Kamal',
    gender: 'female',
    specialty: 'cardiologist',
    city: 'Islamabad',
    since: 2012,
    clinics: 1,
    video: true,
  },
  {
    key: 'dr18',
    title: 'dr',
    name: 'Adeel Butt',
    gender: 'male',
    specialty: 'ent-specialist',
    city: 'Lahore',
    since: 2010,
    clinics: 1,
    video: false,
  },
  {
    key: 'dr19',
    title: 'dr',
    name: 'Maria Khan',
    gender: 'female',
    specialty: 'ent-specialist',
    city: 'Karachi',
    since: 2017,
    clinics: 1,
    video: true,
  },
  {
    key: 'dr20',
    title: 'dr',
    name: 'Asad Hussain',
    gender: 'male',
    specialty: 'eye-specialist',
    city: 'Karachi',
    since: 2006,
    clinics: 2,
    video: false,
  },
  {
    key: 'dr21',
    title: 'assoc_prof',
    name: 'Nida Javed',
    gender: 'female',
    specialty: 'eye-specialist',
    city: 'Islamabad',
    since: 2008,
    clinics: 1,
    video: false,
  },
  {
    key: 'dr22',
    title: 'dr',
    name: 'Omer Sheikh',
    gender: 'male',
    specialty: 'orthopedic-surgeon',
    city: 'Lahore',
    since: 2009,
    clinics: 2,
    video: false,
  },
  {
    key: 'dr23',
    title: 'dr',
    name: 'Shahid Anwar',
    gender: 'male',
    specialty: 'orthopedic-surgeon',
    city: 'Karachi',
    since: 2004,
    clinics: 1,
    video: false,
  },
  {
    key: 'dr24',
    title: 'dr',
    name: 'Amna Yousaf',
    gender: 'female',
    specialty: 'orthopedic-surgeon',
    city: 'Islamabad',
    since: 2016,
    clinics: 1,
    video: false,
  },
  {
    key: 'dr25',
    title: 'dr',
    name: 'Waqas Ali',
    gender: 'male',
    specialty: 'gastroenterologist',
    city: 'Lahore',
    since: 2011,
    clinics: 1,
    video: true,
  },
  {
    key: 'dr26',
    title: 'dr',
    name: 'Sobia Naqvi',
    gender: 'female',
    specialty: 'gastroenterologist',
    city: 'Islamabad',
    since: 2014,
    clinics: 1,
    video: false,
  },
  {
    key: 'dr27',
    title: 'dr',
    name: 'Junaid Iqbal',
    gender: 'male',
    specialty: 'dentist',
    city: 'Karachi',
    since: 2015,
    clinics: 2,
    video: false,
  },
  {
    key: 'dr28',
    title: 'dr',
    name: 'Areeba Saleem',
    gender: 'female',
    specialty: 'dentist',
    city: 'Lahore',
    since: 2019,
    clinics: 1,
    video: false,
  },
  {
    key: 'dr29',
    title: 'dr',
    name: 'Haris Mirza',
    gender: 'male',
    specialty: 'endocrinologist',
    city: 'Karachi',
    since: 2010,
    clinics: 1,
    video: true,
  },
  {
    key: 'dr30',
    title: 'asst_prof',
    name: 'Lubna Aslam',
    gender: 'female',
    specialty: 'endocrinologist',
    city: 'Lahore',
    since: 2007,
    clinics: 1,
    video: true,
  },
];

export const SPECIALTY_PROFILE: Record<
  string,
  {
    degree: string;
    institutes: string[];
    services: string[];
    conditions: string[];
    baseFee: number;
    slotMinutes: number;
    colour: string;
  }
> = {
  'general-physician': {
    degree: 'FCPS (Medicine)',
    institutes: ['College of Physicians and Surgeons Pakistan'],
    services: [
      'General check-up',
      'Fever and flu care',
      'Blood pressure monitoring',
      'Vaccination advice',
    ],
    conditions: ['fever', 'flu', 'cough', 'vitamin-d-deficiency'],
    baseFee: 1500,
    slotMinutes: 15,
    colour: '#1F6F5C',
  },
  dermatologist: {
    degree: 'FCPS (Dermatology)',
    institutes: ['College of Physicians and Surgeons Pakistan'],
    services: [
      'Acne treatment',
      'Acne scar treatment',
      'Hair loss treatment',
      'Chemical peels',
    ],
    conditions: [
      'acne',
      'eczema',
      'hair-loss',
      'pigmentation',
      'fungal-infection',
    ],
    baseFee: 2500,
    slotMinutes: 15,
    colour: '#8A3B5C',
  },
  gynecologist: {
    degree: 'FCPS (Obstetrics & Gynaecology)',
    institutes: ['College of Physicians and Surgeons Pakistan'],
    services: [
      'Antenatal care',
      'PCOS management',
      'Menstrual problems',
      'Family planning',
    ],
    conditions: ['pcos', 'pregnancy', 'irregular-periods', 'menopause'],
    baseFee: 2500,
    slotMinutes: 15,
    colour: '#9C3D6B',
  },
  pediatrician: {
    degree: 'FCPS (Paediatrics)',
    institutes: ['College of Physicians and Surgeons Pakistan'],
    services: [
      'Well-baby check-up',
      'Childhood vaccination',
      'Growth monitoring',
      'Newborn care',
    ],
    conditions: ['child-growth', 'newborn-jaundice', 'fever', 'cough'],
    baseFee: 2000,
    slotMinutes: 15,
    colour: '#2A6FA8',
  },
  psychiatrist: {
    degree: 'FCPS (Psychiatry)',
    institutes: ['College of Physicians and Surgeons Pakistan'],
    services: [
      'Depression treatment',
      'Anxiety management',
      'Sleep problems',
      'Medication review',
    ],
    conditions: ['depression', 'anxiety', 'insomnia', 'ocd'],
    baseFee: 3000,
    slotMinutes: 30,
    colour: '#5B4B8A',
  },
  cardiologist: {
    degree: 'FCPS (Cardiology)',
    institutes: ['College of Physicians and Surgeons Pakistan'],
    services: [
      'ECG review',
      'Echocardiography',
      'Hypertension management',
      'Cardiac risk assessment',
    ],
    conditions: ['hypertension', 'heart-disease'],
    baseFee: 3500,
    slotMinutes: 15,
    colour: '#A33A3A',
  },
  'ent-specialist': {
    degree: 'FCPS (Otorhinolaryngology)',
    institutes: ['College of Physicians and Surgeons Pakistan'],
    services: [
      'Ear wax removal',
      'Sinus treatment',
      'Hearing assessment',
      'Tonsil care',
    ],
    conditions: ['sinusitis', 'ear-infection', 'tonsillitis', 'vertigo'],
    baseFee: 2000,
    slotMinutes: 15,
    colour: '#2E7D8C',
  },
  'eye-specialist': {
    degree: 'FCPS (Ophthalmology)',
    institutes: ['College of Physicians and Surgeons Pakistan'],
    services: [
      'Eye examination',
      'Cataract assessment',
      'Glaucoma screening',
      'Spectacle prescription',
    ],
    conditions: ['weak-eyesight', 'cataract', 'glaucoma', 'conjunctivitis'],
    baseFee: 2000,
    slotMinutes: 15,
    colour: '#2F5D8A',
  },
  'orthopedic-surgeon': {
    degree: 'FCPS (Orthopaedic Surgery)',
    institutes: ['College of Physicians and Surgeons Pakistan'],
    services: [
      'Joint pain assessment',
      'Fracture care',
      'Sports injury rehabilitation',
      'Back pain treatment',
    ],
    conditions: ['back-pain', 'fracture', 'sports-injury', 'osteoporosis'],
    baseFee: 2500,
    slotMinutes: 15,
    colour: '#6B5B2E',
  },
  gastroenterologist: {
    degree: 'FCPS (Gastroenterology)',
    institutes: ['College of Physicians and Surgeons Pakistan'],
    services: [
      'Acidity treatment',
      'IBS management',
      'Endoscopy consultation',
      'Liver function review',
    ],
    conditions: ['acidity', 'ibs', 'constipation', 'diarrhea'],
    baseFee: 3000,
    slotMinutes: 15,
    colour: '#7A4E2D',
  },
  dentist: {
    degree: 'BDS',
    institutes: [
      'de’Montmorency College of Dentistry',
      'Dow University of Health Sciences',
    ],
    services: [
      'Scaling and polishing',
      'Fillings',
      'Root canal treatment',
      'Tooth extraction',
    ],
    conditions: ['toothache', 'gum-disease'],
    baseFee: 1500,
    slotMinutes: 30,
    colour: '#2D7A6B',
  },
  endocrinologist: {
    degree: 'FCPS (Endocrinology)',
    institutes: ['College of Physicians and Surgeons Pakistan'],
    services: [
      'Diabetes management',
      'Thyroid disorders',
      'Insulin initiation',
      'Hormone evaluation',
    ],
    conditions: ['diabetes', 'thyroid'],
    baseFee: 3000,
    slotMinutes: 15,
    colour: '#4A6B2E',
  },
};

/** Medical colleges for the MBBS line (generic, well-known teaching institutions). */
export const MBBS_COLLEGES: Record<City, string[]> = {
  Lahore: [
    'King Edward Medical University',
    'Allama Iqbal Medical College',
    'Services Institute of Medical Sciences',
  ],
  Karachi: [
    'Dow Medical College',
    'Sindh Medical College',
    'Karachi Medical and Dental College',
  ],
  Islamabad: [
    'Rawalpindi Medical University',
    'Army Medical College',
    'Federal Medical College',
  ],
};

export const CITY_AREAS: Record<
  City,
  Array<{ area: string; lat: number; lng: number }>
> = {
  Lahore: [
    { area: 'Gulberg III', lat: 31.5102, lng: 74.3441 },
    { area: 'DHA Phase 5', lat: 31.4697, lng: 74.4089 },
    { area: 'Johar Town', lat: 31.4697, lng: 74.2728 },
    { area: 'Model Town', lat: 31.4834, lng: 74.3255 },
  ],
  Karachi: [
    { area: 'Clifton', lat: 24.8138, lng: 67.0305 },
    { area: 'Gulshan-e-Iqbal', lat: 24.9204, lng: 67.0932 },
    { area: 'PECHS', lat: 24.8697, lng: 67.0599 },
    { area: 'North Nazimabad', lat: 24.9421, lng: 67.0389 },
  ],
  Islamabad: [
    { area: 'F-8 Markaz', lat: 33.7104, lng: 73.0379 },
    { area: 'Blue Area', lat: 33.7189, lng: 73.0715 },
    { area: 'G-9 Markaz', lat: 33.6937, lng: 73.0261 },
    { area: 'E-11', lat: 33.6973, lng: 72.9758 },
  ],
};

/** Weekly hours per clinic slot (1st, 2nd, 3rd clinic) — never overlapping each other or video. */
export const CLINIC_HOURS: Array<Array<[number, string, string]>> = [
  // Evenings, Monday–Saturday.
  [1, 2, 3, 4, 5, 6].map((d) => [d, '17:00', '21:00']),
  // Mornings, Monday–Friday, plus Saturday late morning.
  [
    ...[1, 2, 3, 4, 5].map(
      (d) => [d, '09:30', '13:00'] as [number, string, string],
    ),
    [6, '10:00', '13:00'],
  ],
  // Sunday afternoon.
  [[0, '11:00', '15:00']],
];
/** Video after the evening clinic, Monday–Friday. */
export const VIDEO_HOURS: Array<[number, string, string]> = [1, 2, 3, 4, 5].map(
  (d) => [d, '21:30', '23:00'],
);

export const DEMO_PATIENTS: Array<{
  key: string;
  name: string;
  gender: Gender;
  phone: string;
  age: number;
}> = [
  {
    key: 'patient1',
    name: 'Ali Raza',
    gender: 'male',
    phone: '03001234501',
    age: 34,
  },
  {
    key: 'patient2',
    name: 'Maham Javed',
    gender: 'female',
    phone: '03001234502',
    age: 27,
  },
  {
    key: 'patient3',
    name: 'Saad Khalid',
    gender: 'male',
    phone: '03001234503',
    age: 45,
  },
  {
    key: 'patient4',
    name: 'Iqra Sohail',
    gender: 'female',
    phone: '03001234504',
    age: 31,
  },
  {
    key: 'patient5',
    name: 'Danish Aziz',
    gender: 'male',
    phone: '03001234505',
    age: 52,
  },
  {
    key: 'patient6',
    name: 'Kiran Abbas',
    gender: 'female',
    phone: '03001234506',
    age: 23,
  },
  {
    key: 'patient7',
    name: 'Yasir Hameed',
    gender: 'male',
    phone: '03001234507',
    age: 61,
  },
  {
    key: 'patient8',
    name: 'Noor Fatima',
    gender: 'female',
    phone: '03001234508',
    age: 38,
  },
];

export const REVIEW_TEXTS: Record<'good' | 'ok' | 'bad', string[]> = {
  good: [
    'Very patient and explained everything clearly.',
    'Doctor sahab ne bohat tasalli se baat suni. Highly recommended.',
    'Got relief within a week. Clinic staff was helpful.',
    'Explained the treatment plan step by step, no unnecessary medicines.',
    'Bohat acha experience, waiting bhi zyada nahi thi.',
    'Took time to answer all my questions.',
  ],
  ok: [
    'Good consultation but had to wait a while.',
    'Treatment is working, clinic was a bit crowded.',
    'Theek tha, lekin appointment time se thora late start hua.',
  ],
  bad: [
    'Felt rushed during the visit.',
    'Long wait and the consultation was short.',
  ],
};
