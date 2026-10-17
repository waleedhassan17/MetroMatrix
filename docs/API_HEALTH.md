# MetroMatrix API — Chunk 3 contract (Healthcare)

This file is the contract the Healthcare app chunk is built from. Everything in it is
enforced by the e2e suite:

- `test/health-*.e2e-spec.ts`;
- the release gate `test/qa-matrix-health.e2e-spec.ts` (27 rows).

The live schema is at `GET /api/docs-json`; Swagger UI is at `/api/docs` where it is enabled.
The conventions in `docs/API_AUTH.md` (envelope, tokens, `X-Request-Id`) all apply. Video is
covered in `docs/VIDEO.md`.

**Base URL:** `https://<host>/api/v1`. Routes live under:

| Area | Prefix |
|---|---|
| Discovery and patient | `/health` |
| Doctor | `/health/doctor` |
| Staff | `/admin/health` |

The bare `GET /health` is the liveness check.

**MetroMatrix never holds money.** Patients pay the doctor directly: at the clinic, or by
transfer to the doctor's own account for video. There is no wallet, payout, commission or
platform fee. Fees in doctor screens are **recorded**, never "earnings".

**Money is whole rupees.** The fee always comes from the location; a fee sent by a client is
ignored.

**Times.** Every appointment and slot time is ISO-8601 **with the location's offset**,
e.g. `2026-10-16T18:30:00.000+05:00`. Labels such as "Available today, 6:00 PM" are built
by the server in the location's own timezone, whatever timezone the server runs in. Plain
bookkeeping timestamps (a review's `createdAt`) are UTC. Day boundaries in insights and jobs
are Pakistan days (`Asia/Karachi`).

---

## 1. Conventions

| Rule | What it means for the app |
|---|---|
| Envelope | `{ success: true, data }` or `{ success: false, error: { code, message, details? } }`. Branch on `error.code`. |
| Lists | `data: { items, total, page, pageSize }`, with `?page=1&pageSize=20` (max 100). |
| Optional auth | Discovery works signed out. Signed in, `/health/home` adds `upcomingAppointment`. |
| Patient routes | Role `customer` with a **verified email**. Otherwise `403 FORBIDDEN` or `403 EMAIL_NOT_VERIFIED`. |
| Doctor routes | Role `partner`, business **approved**, service **healthcare**. Otherwise `403 BUSINESS_NOT_APPROVED`, `BUSINESS_SUSPENDED` or `WRONG_SERVICE` (a shop partner on `/health/doctor/today` gets `403 WRONG_SERVICE`). |
| Isolation | Another patient's appointment, record, prescription or family member is `404 NOT_FOUND`, never 403. The same goes for another doctor's appointment, prescription or review. |
| PHI rule | A doctor sees a person only through an appointment between them. Without one, `/health/doctor/patients/:key` is `404`. Prescriptions are visible to their patient and their prescribing doctor only. A shared record is visible to a doctor only **while it is attached** to that doctor's appointment. Every doctor read of patient data writes a `phi.read` audit event. |
| Idempotency | `POST /health/appointments` and `POST /health/appointments/:code/reschedule` **require** `Idempotency-Key`: a fresh UUID per attempt, reused for retries of the same attempt. Missing key: `400 IDEMPOTENCY_KEY_REQUIRED`. A repeat replays the first response; a repeat that arrives while the first is still running gets `409 IDEMPOTENCY_IN_PROGRESS`. |
| Rate limits | Discovery reads: 600/min per address. Booking: 20/min. Reviews: 10/min. Symptom checker: 20/min per address **and** 10 per user per hour (`429 SYMPTOM_CHECK_LIMIT`). Everything else: the global default. Over the limit: `429 RATE_LIMITED`. |
| Uploads | Files go straight to Cloudinary through `POST /media/sign-upload { purpose }`. Healthcare purposes are `doctor_photo` (doctor), `health_record` (patient, photo or PDF, **private**) and `medical_note` (doctor, photo or PDF, **private**). `payment_proof` is reused for transfer screenshots. For the private purposes, the signed params include `type: "authenticated"`; send it. Uploads made without it are refused. Anyone but the uploader receives short-lived `downloadUrl`s (10 minutes), never the stored URL. |
| Person key | A "patient" on the doctor side is a **person**: the family member if the visit was booked for one, otherwise the booking account. `patientKey` is that id. |

---

## 2. Shared shapes

### `DoctorCard` (doctor lists, suggest, similar, home)

```json
{
  "id": "ada3…", "title": "dr", "fullName": "Sana Iqbal", "displayName": "Dr. Sana Iqbal",
  "photoUrl": "https://…/png?text=SI", "gender": "female",
  "specialty": { "id": "a8d0…", "name": "Dermatologist", "nameUr": "ماہر امراض جلد", "slug": "dermatologist" },
  "qualifications": "MBBS, FCPS (Dermatology)", "yearsExperience": 15,
  "ratingAvg": 4.16, "ratingCount": 37, "satisfactionPct": 76, "avgWaitMinutes": 17,
  "pmdcVerified": true, "isTopBooked": false, "minFee": 2000, "offersVideo": true, "offersClinic": true,
  "nextAvailable": { "at": "2026-10-16T18:15:00.000+05:00", "locationKind": "clinic", "label": "Available today, 6:15 PM" }
}
```

- `satisfactionPct` is the share of visible reviews that recommend the doctor. It is
  `null` until there are 5 reviews.
- `avgWaitMinutes` is **measured**, not self-reported:
  - clinic visits: started − max(checked in, booked time);
  - video visits: started − booked time.

  It covers 90 days of completed visits and is `null` until there are 5 samples.
- The `nextAvailable.label` forms are:
  - `Available today, 6:00 PM`
  - `Available tomorrow from 2:00 PM`
  - `Next available Thu 15 Oct`
  - `null` when nothing is free inside the booking window.
- `distanceKm` is added when `lat` and `lng` are sent.
- `offersVideo` / `offersClinic`: the doctor has an active location of that kind.

### `DoctorProfile` (`GET /health/doctors/:id`)

It extends `DoctorCard` with:

```json
{
  "about": "…", "languages": ["English", "Urdu", "Punjabi"], "pmdcNumber": "DEMO-00001-P",
  "badges": { "pmdcVerified": true, "topBooked": false },
  "stats": { "ratingAvg": 4.16, "ratingCount": 37, "satisfactionPct": 76, "avgWaitMinutes": 17,
             "avgConsultMinutes": 15, "patientsServed": 8, "yearsExperience": 15 },
  "booking": { "isAccepting": true, "bookingWindowDays": 14, "cancelCutoffMinutes": 120, "videoPrepayRequired": false },
  "secondarySpecialties": [], "conditions": [{ "id": "…", "name": "Acne", "nameUr": "کیل مہاسے", "slug": "acne" }],
  "services": ["Acne treatment", "Acne scar treatment"],
  "qualificationList": [{ "degree": "MBBS", "institute": "King Edward Medical University", "year": 2010 }],
  "experiences": [{ "designation": "Consultant", "institute": "…", "fromYear": 2016, "toYear": null }],
  "locations": [{
    "id": "528c…", "kind": "clinic", "name": "Model Town Clinic", "addressLine": "13-A Main Boulevard",
    "area": "Model Town", "city": "Lahore", "lat": 31.487, "lng": 74.3212, "phone": "+923007000000",
    "timezone": "Asia/Karachi", "fee": 2500, "slotMinutes": 15, "instructions": "Ask for your token at reception.",
    "nextAvailable": { "at": "…", "label": "Available today, 6:15 PM" },
    "timings": [{ "weekday": 1, "weekdayLabel": "Mon", "ranges": [{ "start": "17:00", "end": "21:00", "label": "5:00 PM – 9:00 PM" }] }]
  }],
  "reviewSummary": {
    "count": 37, "averages": { "overall": 4.2, "diagnosis": 4.1, "staff": 3.9, "environment": 4 },
    "satisfactionPct": 76, "distribution": [1, 0, 3, 9, 24],
    "topTags": [{ "tag": "explained_well", "count": 12 }], "latest": ["Review", "…3"]
  }
}
```

Weekdays are `0` (Sunday) to `6` (Saturday). A video location has no address and
`city: null`. `reviewSummary.distribution` counts visible reviews per star: index 0 is one
star, index 4 is five.

### `Slots` (`GET /health/doctors/:id/locations/:locationId/slots?from=YYYY-MM-DD&days=7`)

`days` is 1–14 and `from` defaults to today in the location's timezone.

```json
{
  "doctorId": "…",
  "location": { "id": "…", "kind": "clinic", "name": "…", "area": "Model Town", "city": "Lahore", "timezone": "Asia/Karachi", "fee": 2500, "slotMinutes": 15 },
  "days": [{
    "date": "2026-10-16", "weekday": 5, "weekdayLabel": "Fri", "dateLabel": "Fri 16 Oct", "isAvailable": true,
    "slots": [{ "startsAt": "2026-10-16T18:30:00.000+05:00", "endsAt": "2026-10-16T18:45:00.000+05:00", "period": "evening" }]
  }]
}
```

Availability is **computed**, never stored. A slot is shown when all of these hold:

- it is on the weekly hours;
- it is at or after now + the minimum notice;
- it falls inside the booking window (today … today + `bookingWindowDays` − 1);
- it is not in time off;
- it does not overlap any active appointment of this doctor **at any location**.

Periods: `morning` before 12:00, `afternoon` before 17:00, `evening` before 21:00,
`night` from 21:00 (local time). DST gaps are skipped and repeated hours take their first
occurrence; Pakistan has no DST, but other zones work.

### `PatientAppointment` (patient detail, list items, booking and reschedule responses)

```json
{
  "id": "ca6f…", "code": "HC-NFCEDP", "status": "booked", "kind": "clinic",
  "startsAt": "2026-10-16T20:30:00.000+05:00", "endsAt": "2026-10-16T20:45:00.000+05:00",
  "patient": { "name": "Maham Javed", "gender": null, "age": null, "phone": "+923001234502", "relation": null },
  "familyMemberId": null, "reason": "Acne for six months", "symptoms": ["pimples", "redness"], "fee": 2500,
  "payment": { "method": "pay_at_clinic", "status": "unpaid", "payBy": null, "paidAt": null, "paymentRef": null,
               "proofUrl": null, "rejectedReason": null, "accounts": null, "refundRef": null, "refundedAt": null },
  "lateCancel": false, "cancelledBy": null, "cancelReason": null, "rescheduledFromId": null,
  "bookedAt": "…", "checkedInAt": null, "startedAt": null, "completedAt": null, "cancelledAt": null,
  "doctor": { "id": "…", "displayName": "Dr. Sana Iqbal", "photoUrl": "…", "specialty": "Dermatologist" },
  "location": { "id": "…", "kind": "clinic", "name": "…", "addressLine": "…", "area": "…", "city": "Lahore",
                "lat": 31.487, "lng": 74.3212, "phone": "…", "instructions": "…", "timezone": "Asia/Karachi" },
  "cancelCutoffAt": "2026-10-16T18:30:00.000+05:00", "prescriptionId": null, "reviewed": false,
  "events": [{ "kind": "status", "from": null, "to": "booked", "actorRole": "patient", "note": null, "at": "…" }],
  "sharedRecords": [],
  "can": { "cancel": true, "reschedule": true, "joinVideo": false, "shareRecords": true, "submitPaymentProof": false, "review": false }
}
```

- `events` and `sharedRecords` appear on the detail view only.
- `patient` is a **snapshot** taken at booking; later edits to the family member don't
  rewrite it.
- `payment.accounts` is set for transfer appointments: the doctor's own accounts as they
  were at booking (`kind`, `accountTitle`, `accountNumber`, `bankName`).
- `cancelCutoffAt` is the start minus the doctor's `cancelCutoffMinutes`: until then a
  reschedule is allowed and a cancel isn't late.
- `prescriptionId` is the prescription written for this visit (`GET /health/prescriptions/:id`),
  or `null`; `reviewed` says whether the patient has reviewed it.
- Draw buttons from `can.*` only; never re-implement the rules in the app.

### `DoctorAppointment` (doctor today queue, doctor list, doctor detail)

It is the same core as `PatientAppointment`, plus:

```json
{
  "patientKey": "4aa6…",
  "location": { "id": "…", "kind": "clinic", "name": "…", "area": "Model Town", "timezone": "Asia/Karachi" },
  "waitingMinutes": 7,
  "flags": { "firstVisit": false, "lateCancels": 0, "noShows": 1 },
  "can": { "checkIn": true, "start": false, "complete": false, "noShow": false, "cancel": true, "writePrescription": false,
           "joinVideo": false, "confirmPayment": false, "rejectPayment": false, "refund": false }
}
```

- `can.confirmPayment`: a transfer the doctor may mark received (awaiting it, or proof sent).
  `can.rejectPayment`: proof was sent. `can.refund`: a refund is due.

- `waitingMinutes` runs while the patient is checked in, counted from max(arrival, booked
  time).
- `flags` count history **with this doctor only**.
- The detail view adds:
  - `events`;
  - `history`: `{ previousAppointments: […], prescriptions: […] }`, both with this doctor
    only;
  - `sharedRecords`: metadata only (`id`, `title`, `type`, `recordDate`, `notes`,
    `fileCount`, `mimes`, `sharedAt`).

### `Prescription` (patient and prescribing doctor)

```json
{
  "id": "91ab…", "appointmentCode": "HC-NFCEDP", "appointmentKind": "clinic", "visitDate": "2026-10-16",
  "issuedAt": "…", "updatedAt": "…", "editableUntil": "2026-10-17T21:00:00.000+05:00", "locked": false,
  "doctor": { "id": "…", "displayName": "Dr. Sana Iqbal", "qualifications": "MBBS, FCPS (Dermatology)",
              "pmdcNumber": "DEMO-00001-P", "specialty": "Dermatologist", "photoUrl": "…" },
  "location": { "id": "…", "kind": "clinic", "name": "…", "addressLine": "…", "area": "…", "city": "Lahore", "phone": "…" },
  "patient": { "name": "Maham Javed", "gender": null, "age": null, "phone": "…", "relation": null },
  "familyMemberId": null, "diagnosis": "Acne vulgaris (moderate)", "advice": "Gentle cleanser twice a day.",
  "followUpInDays": 30, "followUpOn": "2026-11-15",
  "medicines": [{ "name": "Doxycycline", "strength": "100 mg", "form": "capsule", "dosePattern": "1+0+0",
                  "timing": "after_meal", "durationDays": 30, "instructions": null }],
  "tests": [{ "name": "CBC", "instructions": null }]
}
```

The doctor header holds what the app needs to render a printable or PDF prescription.

| Field | Values |
|---|---|
| `form` | `tablet`, `capsule`, `syrup`, `injection`, `cream`, `drops`, `other` |
| `timing` | `before_meal`, `after_meal`, `with_meal`, `bedtime`, `as_needed` |
| `dosePattern` | morning+afternoon+night, e.g. `1+0+1` (free text up to 20 characters) |

`editableUntil` is `null` until the visit is completed.

### `HealthRecord` (the owner's view)

```json
{
  "id": "…", "title": "CBC — March", "type": "lab_report", "recordDate": "2026-03-14", "notes": null,
  "familyMemberId": null,
  "files": [{ "url": "https://res.cloudinary.com/…/image/authenticated/s--…--/v1/…/a1.pdf", "publicId": "…",
              "mime": "application/pdf", "downloadUrl": "https://api.cloudinary.com/v1_1/…/download?…", "expiresAt": "…" }],
  "sharedWith": ["HC-NFCEDP"], "createdAt": "…", "updatedAt": "…"
}
```

- `type` is one of `lab_report`, `prescription`, `scan`, `discharge_summary`, `other`.
- A record holds 1–10 files.
- The doctor's view (`GET /health/doctor/appointments/:code/records/:recordId`) has the same
  metadata, but `files` carries only `mime`, `downloadUrl` and `expiresAt`.

### `Review`

```json
{
  "id": "…", "author": "Maham J.", "isAnonymous": false, "verifiedVisit": true, "kind": "clinic",
  "overall": 5, "diagnosis": 5, "staff": 4, "environment": 4, "recommend": true,
  "tags": ["explained_well", "on_time"], "text": "Listened carefully.", "createdAt": "2026-10-16T12:16:12.205Z",
  "reply": { "text": "Thank you!", "at": "…" }
}
```

- `author` is the first name plus an initial. An anonymous review shows initials only
  (`"M. J."`).
- `tags` come from a fixed set: `no_wait`, `great_experience`, `explained_well`, `friendly`,
  `on_time`, `clean_clinic`, `value_for_money`.
- `environment` is for clinic visits only; on a video visit it is always `null`.
- The doctor's list adds `appointmentCode`, `hidden` and `hiddenReason`; the staff list adds
  `doctorId`, `doctorName`, `patientUserId`, `authorName` and `hiddenAt`.

### `HealthHome` (`GET /health/home?city`)

```json
{
  "city": "Lahore", "cities": ["Lahore", "Karachi", "Islamabad"],
  "specialties": [{ "id": "…", "name": "Dermatologist", "nameUr": "…", "slug": "dermatologist", "icon": "skin",
                    "description": "…", "doctorCount": 4 }],
  "commonConditions": [{ "id": "…", "name": "Acne", "nameUr": "…", "slug": "acne", "isCommon": true, "icon": "sparkles",
                         "specialties": [{ "id": "…", "name": "Dermatologist", "nameUr": "…", "slug": "dermatologist" }] }],
  "availableTodayNearby": ["DoctorCard", "…"], "featuredDoctors": ["DoctorCard", "…"], "featuredScope": "city",
  "upcomingAppointment": null,
  "banners": [{ "id": "…", "imageUrl": "https://…", "title": "Skin and hair specialists", "subtitle": "…",
                "targetType": "specialty", "targetScreen": null,
                "target": { "id": "…", "slug": "dermatologist", "name": "Dermatologist" } }],
  "emergencyNumbers": [{ "label": "Rescue", "number": "1122" }, { "label": "Edhi ambulance", "number": "115" }]
}
```

- `city`: the one asked for (in its usual spelling when doctors practise there); else the
  signed-in patient's default address city, when doctors practise there; else the city with
  the most listed doctors. `cities` are the cities with listed doctors, most first.
- `specialties`: the top 12 by bookings, each with `doctorCount` **in that city**.
- `availableTodayNearby`: the first page of the city's earliest-first list.
- `featuredDoctors`: the city's top 10 by the `recommended` score. When nobody practises in
  the city, the best doctors anywhere, and `featuredScope` is `nationwide`.
- `banners`: staff promotions that are live now (active, inside `startsAt`–`endsAt`), for
  this city or every city, whose target still exists: an active specialty or condition, a
  listed doctor. At most 10, by `sort`. `target` is resolved (a doctor carries their display
  name); `targetType` `screen` opens one of the app's Health screens (`targetScreen`:
  `video_consultation`, `symptom_checker`, `emergency`, `records`, `available_today`);
  `none` opens nothing.
- Condition and specialty `icon`s are keys (`skin`, `thermometer` …); the app maps them to
  its icon set.

---

## 3. State machines

### Appointment status (`src/modules/healthcare/appointments/appointment-status.ts`)

```
booked ──(clinic) check-in──▶ checked_in ──start──▶ in_consultation ──complete──▶ completed
  │      (video) start / doctor joins the call ─────▶
  ├──▶ cancelled   (patient, doctor, system, admin)
  └──▶ no_show     (doctor from starts + 15 min; system at ends + 2 h)
```

| From → to | Who | Notes |
|---|---|---|
| booked → checked_in | doctor | Clinic only. |
| booked → in_consultation | doctor | Video only. A clinic visit must be checked in first. |
| booked → cancelled | patient, doctor, system, admin | See the cancel rules below. |
| booked → no_show | doctor, system | Doctor: from `startsAt + 15 min` (earlier → `409 INVALID_TRANSITION`). System: at `endsAt + 2 h`. |
| checked_in → in_consultation | doctor | |
| checked_in → cancelled | doctor, system, admin | |
| in_consultation → completed | doctor | `{ paymentCollected: true }` marks an outstanding fee paid. |

Any other move is `409 INVALID_TRANSITION { from, to, allowed }`. `booked`, `checked_in` and
`in_consultation` hold the doctor's time. The database refuses two overlapping holds for one
doctor, at any locations (an exclusion constraint), and the API answers `409 SLOT_TAKEN`.

**Patient cancel:**

- before the cutoff (`cancelCutoffMinutes`, default 120): a normal cancel;
- inside the cutoff: allowed, marked `lateCancel: true`;
- after the start: `409 CANCEL_CUTOFF_PASSED`.

**Reschedule:** same doctor and location, before the cutoff, **once**. One transaction
cancels the old visit (reason "Rescheduled") and books the new one, which links back through
`rescheduledFromId`.

- Rescheduling a rescheduled appointment: `409 RESCHEDULE_NOT_ALLOWED`.
- Rescheduling inside the cutoff: `409 CANCEL_CUTOFF_PASSED`.
- A paid or claimed payment moves to the new appointment.
- Shared records move too.

### Payment status (`appointments/payment-status.ts`)

| Method | Path |
|---|---|
| `pay_at_clinic` | `unpaid → paid` (the doctor marks it at completion or confirms it) · `→ void` on cancel or no-show |
| `transfer` (video) | `awaiting_transfer → proof_submitted → paid` · rejected `proof_submitted → awaiting_transfer` (`rejectedReason`) · `→ void` on cancel |
| After payment | cancelled after `paid` or `proof_submitted` → `refund_due → refunded` (the doctor records `refundRef`; the money moves off-platform) |

- **Prepayment:** when the doctor sets `videoPrepayRequired` and has an active payment
  account, a video booking gets `payBy = min(booked + 2 h, starts − 30 min)`, but never
  earlier than 10 minutes after booking.
- Still unpaid at `payBy`: the system cancels, the slot is freed, and both sides are told.
- Joining the call needs `paid`; until then the join route returns `402 PAYMENT_REQUIRED`.
- A rejected proof gives the patient at least 2 hours to resubmit, but never past the start.

---

## 4. Endpoints

### 4.1 Discovery (public, optional auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/health/home?city` | `HealthHome` (§2): city, cities, specialties with `doctorCount`, common conditions, available today, featured doctors, live banners, emergency numbers, and the signed-in patient's `upcomingAppointment`. |
| GET | `/health/specialties?city` | All active specialties, with `doctorCount` (listed doctors, in `city` when given). |
| GET | `/health/conditions?q&common=true` | Conditions with their ranked specialties. Matches English names, Urdu names and aliases ("pimples" → Acne); trigram matching for typos. |
| GET | `/health/search/suggest?q` | `{ doctors (5 cards), specialties (3), conditions (3) }`. "skin", "pimples" and "ماہر امراض جلد" all find Dermatologist. |
| GET | `/health/doctors` | Filters: `q`, `specialtyId` or `specialty` (slug), `conditionId` or `condition` (slug), `city`, `area`, `kind=clinic\|video`, `availableToday`, `gender`, `minFee`, `maxFee`, `minExperience`, `minRating`, `language`, `lat`, `lng`. Sorts: `sort=recommended\|earliest\|fee_asc\|fee_desc\|reviews\|experience`. `city` is ignored for `kind=video`. Fee filters and fee sorts use the cheapest active location of the requested `kind` (any kind when it isn't given). |
| GET | `/health/doctors/:id` | `DoctorProfile`. An unlisted or unknown doctor: `404 DOCTOR_NOT_LISTED`. |
| GET | `/health/doctors/:id/reviews?sort=latest\|highest\|lowest&kind&rating&page` | Visible reviews (`Review`); `rating` (1–5) keeps one star count. |
| GET | `/health/doctors/:id/similar` | Up to 10 cards: same specialty, same city first, then most reviewed. |
| GET | `/health/doctors/:id/locations/:locationId/slots?from&days` | `Slots`. |

`recommended` is a weighted score:

| Component | Weight |
|---|---|
| Rating (out of 5) | 40% |
| Review count (logarithmic, full at 50) | 25% |
| Next free slot within 24 h (15% within 72 h, 5% later) | 25% |
| Top-booked badge | 10% |
| Distance penalty (when `lat`/`lng` are sent) | up to −30% |

### 4.2 Patient (`/health`, role customer + verified email)

| Method | Path | Body / notes |
|---|---|---|
| GET POST | `/health/family-members` | `{ fullName, relation: spouse\|child\|parent\|sibling\|other, gender?, dateOfBirth?, phone? }`. Max 8. |
| GET PATCH DELETE | `/health/family-members/:id` | Deleting a member keeps past appointment snapshots and deletes that member's health records. |
| POST | `/health/appointments` | Needs `Idempotency-Key`. Body: `{ doctorId, locationId, startsAt, familyMemberId?, reason?, symptoms?, attachmentRecordIds?, paymentMethod? }` → **201** `PatientAppointment`. See below. |
| GET | `/health/appointments?scope=upcoming\|past&page` | `PatientAppointment` items (no events). |
| GET | `/health/appointments/:code` | Detail, with `events`, `sharedRecords` and `can`. |
| POST | `/health/appointments/:code/cancel` | `{ reason }`. See §3. |
| POST | `/health/appointments/:code/reschedule` | Needs `Idempotency-Key`. Body `{ startsAt }`; returns the **new** appointment. |
| POST | `/health/appointments/:code/payment-proof` | `{ paymentRef, proofUrl? }`. For transfer appointments that are `awaiting_transfer`. `proofUrl` is an upload with purpose `payment_proof`. |
| GET POST | `/health/appointments/:code/attachments` | POST `{ recordIds: [1–10] }`: share records **about this appointment's person**, while the visit is booked, checked in or in consultation. Otherwise `409 ATTACHMENTS_CLOSED`. Another person's record: `400`. An unknown or foreign record: `404`. At most 10 per visit. |
| DELETE | `/health/appointments/:code/attachments/:recordId` | Stops sharing. Always allowed; the doctor loses access at once. |
| POST | `/health/appointments/:code/video/join` | See `docs/VIDEO.md`. `409 VIDEO_NOT_JOINABLE` with `reason` `window`, `status` or `not_video`; `402 PAYMENT_REQUIRED`. |
| POST | `/health/appointments/:code/review` | `{ overall 1–5, diagnosis 1–5, staff? 1–5, environment? 1–5 (clinic), recommend, tags?, text? ≤1000, isAnonymous? }`. Only once the visit is `completed`, once only, within 30 days. `403 REVIEW_NOT_ALLOWED` (`details.reason`: `not_completed` or `window_closed`), `409 REVIEW_EXISTS`. |
| GET | `/health/prescriptions?familyMemberId&page` | Your prescriptions, newest first. |
| GET | `/health/prescriptions/:id` | `Prescription`. Someone else's: `404`. |
| GET POST | `/health/records?person=self\|<familyMemberId>&type&page` | POST `{ title, type, recordDate?, notes?, familyMemberId?, files: [{ url, publicId, mime? }] }`. Files must be signed for `health_record`. Max 200 records per account. |
| GET PATCH DELETE | `/health/records/:id` | PATCH `{ title?, type?, recordDate?, notes?, files? }` (files are replaced). DELETE also un-shares the record everywhere. |
| POST | `/health/symptom-checker` | `{ text (10–1000), familyMemberId?, age?, gender? }`. See below. |

**Booking rules.** These are checked in this order, inside one transaction:

1. The doctor must be listed and accepting: otherwise `404 DOCTOR_NOT_LISTED`.
2. The location must be active and belong to the doctor: otherwise `404 NOT_FOUND`.
3. `startsAt` must be **exactly** one of the computed slots: otherwise `400 SLOT_INVALID`.
4. The slot must be free: otherwise `409 SLOT_TAKEN`, with `details.alternatives` holding
   the 3 nearest free slots.
5. The same person must not hold an overlapping active appointment with any doctor:
   otherwise `409 PATIENT_OVERLAP` (`details.appointmentCode`).
6. At most 3 upcoming appointments with one doctor: otherwise `409 BOOKING_LIMIT`.

Further rules:

- **Fee and patient:** the fee comes from the location. `patient` is a snapshot of the
  account, or of the family member (name, gender, age, phone, relation).
- **Payment method:** clinic visits are `pay_at_clinic` and video visits are `transfer`.
  Any other `paymentMethod`: `400`.
- **Attached records:** `attachmentRecordIds` are shared in the same transaction. A bad id
  books nothing.

**Symptom checker.** Answers come in this order, and every answer carries a `disclaimer`:

1. **Red flags** (English and Roman Urdu) answer first and never call a model.
   - The flags: chest pain or pressure; severe breathlessness; stroke signs;
     unconsciousness or a seizure; heavy bleeding; suicidal thoughts; poisoning; a severe
     allergic reaction; fever with a stiff neck; bleeding in pregnancy; serious injury; high
     fever in a baby (any fever under age 1).
   - Response:
     ```json
     { "checkId": "…", "emergency": true, "source": "red_flag", "flags": [{ "id": "chest_pain", "label": "Chest pain or pressure" }],
       "message": "This could be an emergency. Call 1122 or 115 now…",
       "numbers": [{ "label": "Rescue", "number": "1122" }, { "label": "Edhi ambulance", "number": "115" }], "disclaimer": "…" }
     ```
2. **The model:** used only when `GEMINI_API_KEY` is set. The JSON it returns is validated
   with class-validator and its slug is mapped to a live specialty.
3. **The fallback:** a keyword matcher over the reference tables. With no match, the answer
   is General Physician.
   ```json
   { "checkId": "…", "emergency": false, "source": "model|fallback", "urgency": "routine|soon|urgent",
     "advice": "Book a visit in the coming days…", "areasToDiscuss": [{ "title": "Acne", "explanation": "…" }],
     "specialty": { "id": "…", "name": "Dermatologist", "nameUr": "…", "slug": "dermatologist", "icon": "skin", "description": "…" },
     "alternatives": [], "disclaimer": "This is not a diagnosis or medical advice…" }
   ```

Use `specialty.id` to open `/health/doctors?specialtyId=…`. The free text is kept for 30
days, then erased by the nightly job.

### 4.3 Doctor (`/health/doctor`)

| Method | Path | Body / notes |
|---|---|---|
| GET PATCH | `/profile` | `{ title, fullName, gender, photoUrl (purpose doctor_photo; checked only when it changes, so the current photo may be re-sent), primarySpecialtyId, secondarySpecialtyIds, practicingSince, about, languages, qualifications[], experiences[], services[], conditionIds, bookingWindowDays (≤30), minNoticeMinutes, cancelCutoffMinutes, videoPrepayRequired, isAccepting }`. Arrays **replace** the stored lists. `videoPrepayRequired: true` needs an active payment account. |
| GET | `/profile/completeness` | `{ percent, missing: [...], isListed }`. Checks: PMDC verified, name, gender, photo, primary specialty, practising since, about (40+ characters), languages, qualifications, an active location, a weekly schedule. |
| POST | `/listing/publish` · `/listing/unpublish` | Publishing below 100%: `422 PROFILE_INCOMPLETE` (`details.missing`). Unlisted by an admin: `403`. |
| GET POST | `/locations` | `{ kind: clinic\|video, name, addressLine?, area?, city?, lat?, lng?, phone?, timezone? (IANA, default Asia/Karachi), fee, slotMinutes (10–60), instructions? }`. At most one active video location. |
| PATCH DELETE | `/locations/:id` | Deactivating or deleting a location with future bookings: `409 LOCATION_HAS_BOOKINGS` (`details.appointments`). |
| GET PUT | `/locations/:id/schedule` | PUT takes `[{ weekday 0–6, start "HH:MM", end "HH:MM" or "24:00" }]` and replaces the week. Overlap with any of your other locations on the same weekday: `409 SCHEDULE_OVERLAP` (`details.range`, `details.conflict`). |
| GET POST | `/time-off` | `{ startsAt, endsAt, locationId? (null = all), reason?, cancelAffected? }`. If bookings are affected: `409 TIME_OFF_CONFLICTS` (`details.appointments`), unless `cancelAffected: true`, which cancels them and tells the patients. |
| DELETE | `/time-off/:id` | |
| GET | `/availability/preview?from&days=7` | `{ locations: [{ location, days }] }`: the slots patients will see. Works before publishing. |
| GET POST | `/payment-accounts` | `{ kind: raast\|jazzcash\|easypaisa\|bank, accountTitle, accountNumber, bankName? }`. Max 4. Validated as in Shopping (PK IBAN checksum, mobile wallets). |
| PATCH DELETE | `/payment-accounts/:id` | |
| GET | `/today` | `{ date, counts: { total, waiting, inConsultation, remaining, done }, queue: DoctorAppointment[] }`. Order: in consultation, then waiting (by arrival), then still to come (by time), then done. |
| GET | `/appointments?date&from&to&status&locationId&page` | `DoctorAppointment` items. |
| GET | `/appointments/:code` | Detail with `history` and `sharedRecords`. Audited (`phi.read`). |
| POST | `/appointments/:code/check-in` · `/start` · `/complete` · `/no-show` | `complete` takes `{ paymentCollected? }`. See §3. |
| POST | `/appointments/:code/cancel` | `{ reason }` (required). The patient is told; a paid fee becomes `refund_due`. |
| POST | `/appointments/:code/payment/confirm` · `/payment/reject` · `/refund` | reject: `{ reason }`. refund: `{ refundRef }`. |
| GET PUT | `/appointments/:code/notes` | `{ text, files?: [{ url, publicId, mime? }] }`. Files are signed for `medical_note`. These are **private notes, never shown to the patient**. The GET is audited. |
| GET | `/appointments/:code/prescription` | `{ prescription: Prescription \| null, locked }`. |
| POST | `/appointments/:code/prescription` | `{ diagnosis, advice?, followUpInDays?, medicines: [{ name, strength?, form, dosePattern, timing, durationDays?, instructions? }], tests?: [{ name, instructions? }] }`. Writes or replaces, from `in_consultation` until 24 h after completion. Otherwise `409 PRESCRIPTION_LOCKED` (`details.reason`: `not_in_consultation` or `window_closed`). Your medicine favourites update as you write. |
| GET | `/prescriptions/:id` | The prescribing doctor only; any other doctor gets `404`. Audited. |
| GET | `/diagnoses/recent` | Your last 10 distinct diagnoses, newest first (`string[]`), for one-tap reuse. No patient details. |
| GET | `/medicines/suggest?q` | `{ medicines: [{ source: favourite\|reference, name, strength, form, dosePattern, timing, useCount }] }`. Your favourites come first (with your usual dose), then about 400 common generics; typos are tolerated. |
| GET | `/appointments/:code/records/:recordId` | A shared record, **only while attached**; otherwise `404`. Returns a 10-minute download link. Audited. |
| POST | `/appointments/:code/video/join` | Joins as moderator. A `booked` appointment moves to `in_consultation`. |
| GET | `/patients?q&page` | People with an appointment with you. `q` matches name or phone. |
| GET | `/patients/:patientKey` | The history with **you only**. No appointment between you: `404`. Audited. |
| GET | `/reviews?sort&kind&rating&unreplied=true&page` | Your reviews; hidden ones are flagged. |
| GET | `/reviews/summary` | Your review summary as patients see it (`count`, `averages`, `satisfactionPct`, `distribution`, `topTags`, `latest`). |
| POST | `/reviews/:id/reply` | `{ text }`. Public; replaces an earlier reply. |
| GET | `/insights?range=7d\|30d\|90d` | See below. |

**Insights** (`/insights`):

```json
{
  "range": "7d", "from": "2026-10-10", "to": "2026-10-16", "timezone": "Asia/Karachi",
  "perDay": [{ "date": "2026-10-10", "clinic": 2, "video": 0, "total": 2 }],
  "totals": { "appointments": 4, "completed": 4, "cancelled": 0, "lateCancelled": 0, "cancelledByDoctor": 0, "noShow": 0, "upcoming": 0 },
  "rates": { "completion": 1, "cancellation": 0, "noShow": 0 },
  "times": { "avgWaitMinutes": 5, "waitSamples": 4, "avgConsultMinutes": 11, "consultSamples": 4 },
  "patients": { "new": 0, "returning": 3 },
  "fees": { "label": "Recorded by you — MetroMatrix does not process or hold payments.",
            "recorded": 9500, "atClinic": 7500, "byTransfer": 2000, "refundDue": 0, "refunded": 0 },
  "ratingTrend": [{ "date": "2026-10-11", "reviews": 1, "average": 5 }]
}
```

### 4.4 Admin (`/admin/health`, roles `admin` / `super_admin`, every write audited)

| Method | Path | Notes |
|---|---|---|
| GET | `/doctors?pmdc=verified\|unverified&businessId&q&page` | The PMDC verification queue and doctor lookup. Each row has the doctor's `specialty` and the business `documents` (`id`, `kind`, `url`, `status`), e.g. the PMDC certificate to check. |
| POST | `/doctors/:id/pmdc-verify` | `{ note? }`. Approving a doctor's business (`POST /admin/businesses/:id/approve`) needs this first, otherwise `422 PMDC_NOT_VERIFIED`. |
| POST | `/doctors/:id/pmdc-unverify` | `{ reason }`. Also unlists the doctor. |
| POST | `/doctors/:id/unlist` · `/clear-unlist` | `{ reason }`. The doctor can't republish until cleared. |
| GET POST | `/specialties` | `{ name, nameUr, slug, icon?, description?, keywords[], sort? }`. A slug already in use: `409`. |
| PATCH | `/specialties/:id` | Edit, or deactivate with `isActive: false`. Nothing is ever deleted. Affected doctors' search is refreshed at once. |
| GET POST | `/conditions?q&page` | `{ name, nameUr?, slug, aliases[], isCommon?, icon? }`. `icon` is a key for the home's concern chips. |
| PATCH | `/conditions/:id` | |
| PUT | `/conditions/:id/specialties` | `[{ specialtyId, rank }]` replaces the mapping; rank 1 is the first choice. |
| GET | `/reviews?doctorId&hidden=true\|false&page` | |
| POST | `/reviews/:id/hide` · `/unhide` | hide: `{ reason }`. The review leaves public lists and the rating at once. |
| GET | `/appointments?code&doctorId&patientUserId&status&date&page` | Lookup: booking facts and the payment trail, **never** notes, prescriptions or records. `doctor` carries the `businessId`; `hasPrescription` says only whether one was written. |
| GET | `/appointments/:code` | The same, with the timeline. Audited. |
| POST | `/appointments/:code/cancel` | `{ reason }`: cancel on someone's behalf; both sides are told. |
| GET POST | `/banners` | The Health home's banners (all, in order). POST `{ imageUrl (your own upload, purpose banner), title (≤80), subtitle? (≤140), targetType: specialty\|condition\|doctor\|screen\|none, targetId? (specialty, condition, doctor), targetScreen? (screen), city? (null = every city), startsAt?, endsAt?, sort?, isActive? }`. A missing target or one that doesn't exist: `400` on that field. |
| PATCH DELETE | `/banners/:id` | Edit or delete. A new image must be your own upload; the current one may be re-sent. |
| PUT | `/banners/order` | `{ ids }`: these first, in this order; the others follow. Every banner's `sort` is rewritten. |
| GET | `/overview` | `{ date, doctors: { total, listed, awaitingPmdc, unlistedByAdmin }, listedBySpecialty, today: { newBookings, cancellations, noShows, appointmentsByStatus }, last7Days, reviews, symptomChecks, topSpecialties30d }` |

---

## 5. Error codes added in Chunk 3

| Code | HTTP | When |
|---|---|---|
| `DOCTOR_NOT_LISTED` | 404 | Unknown, unlisted or not-accepting doctor (discovery, slots, booking). |
| `SLOT_INVALID` | 400 | `startsAt` isn't one of the doctor's computed slots. |
| `SLOT_TAKEN` | 409 | Someone holds that time, at this or another location. `details.alternatives` (3). |
| `BOOKING_LIMIT` | 409 | 3 upcoming appointments with this doctor already. |
| `PATIENT_OVERLAP` | 409 | This person already has an appointment at that time. |
| `SCHEDULE_OVERLAP` | 409 | Weekly hours overlap another location's. |
| `TIME_OFF_CONFLICTS` | 409 | Time off covers bookings (`details.appointments`). |
| `LOCATION_HAS_BOOKINGS` | 409 | Deactivating or deleting a location with future bookings. |
| `CANCEL_CUTOFF_PASSED` | 409 | Cancel after the start, or reschedule inside the cutoff. |
| `RESCHEDULE_NOT_ALLOWED` | 409 | Already rescheduled once. |
| `VIDEO_NOT_JOINABLE` | 409 | Outside the join window, wrong status, or a clinic visit (`details.reason`). |
| `PAYMENT_REQUIRED` | 402 | Prepaid video not yet confirmed. |
| `PRESCRIPTION_LOCKED` | 409 | Not in consultation yet, or more than 24 h after completion. |
| `PROFILE_INCOMPLETE` | 422 | Publishing below 100% (`details.missing`). |
| `PMDC_NOT_VERIFIED` | 422 | Approving a doctor's business before PMDC verification. |
| `ATTACHMENTS_CLOSED` | 409 | Sharing a record after the visit is completed or cancelled. |
| `SYMPTOM_CHECK_LIMIT` | 429 | 10 checks in the last hour (`details.retryAfterSeconds`). |

Reused codes: `WRONG_SERVICE` (403), `INVALID_TRANSITION` (409), `REVIEW_NOT_ALLOWED` (403),
`REVIEW_EXISTS` (409).

---

## 6. Notifications (`type`; `data` is `{ appointmentCode }` unless noted)

| Type | To | When |
|---|---|---|
| `health.appointment.booked` · `health.appointment.new` | patient · doctor | Booked or rescheduled. |
| `health.appointment.cancelled` | the other side (both after a system or admin cancel) | Any cancel, including unpaid prepay, time off and support. |
| `health.appointment.reminder` | patient | 24 h and 1 h before. Clinic reminders name the location and area; video reminders say "Join from the app 10 minutes before". |
| `health.doctor.today` | doctor | 07:00 local: today's count. |
| `health.payment.proof` · `health.payment.confirmed` · `health.payment.rejected` · `health.payment.refunded` | doctor · patient | Transfer flow. |
| `health.prescription` | patient | Prescription issued or updated. `data: { prescriptionId, appointmentCode }`. |
| `health.review.new` · `health.review.reply` | doctor · patient | `data: { reviewId }`. |

---

## 7. Scheduled jobs (`jobs/health-jobs.service.ts`; advisory-locked, idempotent, `JOBS_ENABLED`)

| Schedule | Job |
|---|---|
| Every 5 min | Cancel prepaid video unpaid at `payBy`. Auto no-show for `booked` appointments past `endsAt + 2 h`. 24 h and 1 h reminders. |
| Every 15 min | Refresh `next_available_at` for listed doctors (time passing). The 07:00-local doctor digest (once a day). |
| 02:00 PKT | Doctor aggregates: rating, satisfaction, wait and consult (shown from 5 samples), patients served, completed in 30 days. Top-booked. Symptom-checker text older than 30 days erased. |

Running any job twice leaves the same state (QA #26).

---

## 8. Decisions this contract makes (beyond the brief)

| Decision | Detail |
|---|---|
| Module location | The module lives in `src/modules/healthcare/`, because `src/modules/health/` was already the liveness check. Routes are still `/health/...`. |
| Doctor onboarding | The PMDC number is captured on the Chunk 1 business profile and is required to submit a doctor's business. The doctor row is created **at submission**, so admins can verify before approving, and approval is blocked until they do. |
| Payment accounts | A new `doctor_payment_accounts` table, because the Shopping accounts are store-specific. |
| Specialty keywords | Specialties carry lay `keywords` ("skin", "jild"). |
| `medicines` table | Seeded from `seed/health/medicines.csv`. |
| `symptom_checks` table | Backs the per-user hourly limit and the 30-day erasure. |
| Video payment | Video is always `transfer`; prepayment applies only when the doctor requires it **and** has an account. |
| Clinic visits | A clinic visit must be checked in before it can start. |
| Auto no-show | Also applies to video visits never started. |
| Reschedule | A paid or claimed payment moves to the new appointment; the old one becomes `void` (system). |
| Rejected proof | The patient gets at least 2 hours to resubmit, never past the start. |
| Patient history | The history and flags a doctor sees count visits **with that doctor only**. |
| Chest pain | A red flag on its own, more cautious than "chest pain **with** breathlessness". |
| Top-booked | Needs a specialty-and-city group of at least two listed doctors; the top is max(1, ⌊10%⌋). |
| PHI files | Health records and note files are private (`authenticated`) Cloudinary assets with expiring download links. |
| Admin extras | The admin cancel and the doctor availability preview are additions. |
| Action flags | Appointment action flags are nested (`can.cancel`, `can.reschedule`, `can.joinVideo`, `can.review`, …). |
| Home banners | `health_banners`, like Shopping's, plus a city and app-screen targets. The home drops a banner whose target has gone (inactive specialty or condition, unlisted doctor) rather than lead to a 404. |
| Featured doctors | The city's top 10 by the `recommended` score; nationwide only when nobody practises in the city (`featuredScope`). |
| Staff and prescriptions | Staff see `hasPrescription` on an appointment, never an id they could follow. |

---

## 9. Demo data (`npm run seed:health`)

The seed is idempotent and refuses to run with pending migrations.

**Doctors:** 30 **fictional** doctors, `demo.dr01@metromatrix.test` … `demo.dr30@metromatrix.test`.

- They cover 12 specialties in Lahore, Karachi and Islamabad.
- Their PMDC numbers are `DEMO-00001-P` and up.
- Each has 1–3 clinics with realistic weekly hours, and half also offer video in the late
  evening (21:30–23:00).
- Each has a licensed stock portrait (Unsplash License, one person per doctor, matched to
  the doctor's gender; photographers in `src/database/seeds/health/CREDITS.md`). Every
  profile's `about` ends with "(Demo profile: this doctor is fictional.)". Demo and
  development data only; a real doctor's own upload replaces it. An initials avatar from an
  earlier run is swapped for the portrait.
- Five home banners (video consultation, skin specialists, the symptom checker,
  paediatricians in Lahore, family records), idempotent by title.
- Qualifications, services, conditions and payment accounts are filled in.

**Patients:** 8 demo patients, `demo.patient1@metromatrix.test` … `demo.patient8@metromatrix.test`.
Patient 1 has two family members.

**History:** about 30 completed past visits per doctor, with real check-in, start and finish
times (so the wait and consult stats exist), and 0–40 reviews per doctor.

All demo accounts use `SEED_DEMO_PASSWORD`. The seed never prints it.

---

## 10. Additions for the app (Chunk 3 P8)

What the Healthcare app reads beyond the first contract, each covered by
`test/health-home.e2e-spec.ts`:

| # | Addition |
|---|---|
| A1 | A doctor's business (`GET /businesses/me`, `GET /admin/businesses/:id`, and the session's `BusinessSummary` from sign-in and `GET /auth/me`) carries `isListed` and `pmdcVerified`. Other businesses don't have the keys. |
| A2 | `GET /health/doctors` takes `specialty` and `condition` slugs as well as ids. |
| A3 | `DoctorCard.offersClinic`. |
| A4 | `reviewSummary.distribution`, `GET /health/doctor/reviews/summary`, and `rating` on review lists. |
| A5 | `PatientAppointment.cancelCutoffAt`, `prescriptionId`, `reviewed`, and the location's `lat`/`lng`. |
| A6 | Staff doctor rows carry `specialty` and `documents`; staff appointments carry `doctor.businessId` and `hasPrescription`. |
| A7 | Staff review rows carry `doctorName`. |
| A9 | `PATCH /health/doctor/profile` checks `photoUrl` ownership only when it changes. |
| A11 | `DoctorAppointment.can.confirmPayment`, `can.rejectPayment`, `can.refund`. |
| A12 | `GET /health/doctor/diagnoses/recent`. |
| Home | `HealthHome.city`, `cities`, `featuredScope`, `banners`, `emergencyNumbers`; `doctorCount` on its specialties; `icon` on conditions. Staff manage banners at `/admin/health/banners`. |
