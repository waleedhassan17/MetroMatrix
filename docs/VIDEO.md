# Video consultations

MetroMatrix doesn't run a video server. A video appointment gets a random room
(`appointments.video_room`, a UUID). The API hands each participant what they
need to open the room in a Jitsi client. Only two people ever get it:

- the patient, through the booking account;
- the doctor, as owner of the appointment.

Everyone else gets `404`, whoever they are.

## Endpoints

| Who | Route | Effect |
|---|---|---|
| Patient | `POST /api/v1/health/appointments/:code/video/join` | Join details (not a moderator). |
| Doctor | `POST /api/v1/health/doctor/appointments/:code/video/join` | Join details (moderator). A `booked` appointment moves to `in_consultation`. |

Both routes return:

```json
{
  "appointmentCode": "HC-7KD2QX",
  "window": { "opensAt": "…", "closesAt": "…" },
  "provider": "jaas",
  "domain": "8x8.vc",
  "roomName": "vpaas-magic-cookie-…/mm-0f6b9c1e-…",
  "joinUrl": "https://8x8.vc/vpaas-magic-cookie-…/mm-0f6b9c1e-…?jwt=…",
  "jwt": "eyJ…",
  "expiresAt": "…",
  "moderator": false
}
```

Mobile apps should pass `domain`, `roomName` and `jwt` to the Jitsi Meet SDK; the
web can use the IFrame API the same way. `joinUrl` is a fallback that opens the
call in a browser.

Rules (the same for both routes):

- **Window:** from 10 minutes before the start until 30 minutes after the end.
  Outside it you get `409 VIDEO_NOT_JOINABLE`, with `details.reason = "window"`
  and the `opensAt` / `closesAt` times.
- **Status:** the appointment must be `booked` or `in_consultation`. Anything
  else gives `409 VIDEO_NOT_JOINABLE` with `reason = "status"`. A clinic
  appointment gives `reason = "not_video"`.
- **Prepayment:** if the doctor requires video prepayment, the transfer must be
  confirmed (`payment.status = "paid"`). Until then the route returns
  `402 PAYMENT_REQUIRED`, to both sides.
- **Join log:** the first join by each side is recorded as an appointment event
  ("Joined the video call"). Rejoins are not recorded.

## Providers (`VIDEO_PROVIDER`)

### `public_jitsi` (default; development and demos)

The join URL is `https://meet.jit.si/mm-<uuid>`. Nothing is signed, and the room
name is the only secret.

meet.jit.si changed its rules on **24 August 2023**. Whoever opens a room must
now sign in (Google, GitHub or Facebook) to become its moderator. Guests still
join without an account. For MetroMatrix this means:

- The doctor should join first and sign in. If the patient arrives first, they
  wait in the lobby.
- MetroMatrix can't make the doctor a moderator on meet.jit.si, so the
  `moderator` flag is only advisory here.
- Avoid this provider in production. It's a free public service with no SLA and
  its own terms of use, and nothing in the call is under our control.

### `jaas` (production)

8x8 **Jitsi as a Service**. Each participant gets their own RS256 room token.
The claims follow 8x8's documentation
(<https://developer.8x8.com/jaas/docs/api-keys-jwt>).

Header:

| Field | Value |
|---|---|
| `alg` | `RS256` |
| `kid` | `JAAS_KID`, formatted `<AppID>/<key id>` |
| `typ` | `JWT` |

Payload:

| Claim | Value |
|---|---|
| `aud` | `"jitsi"` |
| `iss` | `"chat"` |
| `sub` | `JAAS_APP_ID` |
| `room` | `mm-<uuid>`, this room only (never `*`) |
| `nbf` | now − 10 s |
| `exp` | the earlier of the join window's close and now + 2 h |
| `context.user` | `id`, `name`, `avatar`, `email`, `moderator` (`"true"` for the doctor only) |
| `context.features` | `recording`, `livestreaming`, `transcription`, `outbound-call` and `sip-outbound-call`, all `"false"` (nothing leaves a consultation) |

The browser fallback URL is `https://8x8.vc/<AppID>/<room>?jwt=<token>`. 8x8
documents the token for the SDK and IFrame API but not this exact web URL, so
check it with a real key before launch. The SDK path (`domain` + `roomName` +
`jwt`) is the supported one.

Set up:

1. Create a JaaS account. The free **Developer** plan includes **25 monthly
   active users**. Paid plans start at $99/month for 300 MAU, and overage is
   $0.99 per MAU (8x8 pricing page, checked October 2026). There is no card on
   file and nothing is provisioned by this repo. The owner decides.
2. In the JaaS console, generate an API key pair. Download the private key and
   note the key id.
3. Set the config vars (Heroku: `heroku config:set …`):

   ```
   VIDEO_PROVIDER=jaas
   JAAS_APP_ID=vpaas-magic-cookie-…
   JAAS_KID=vpaas-magic-cookie-…/<key id>
   JAAS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n"
   ```

   You can write the PEM on one line with `\n` escapes. If `VIDEO_PROVIDER=jaas`
   and any `JAAS_*` key is missing, boot fails with every problem listed.

## Privacy

- MetroMatrix stores no recordings, chat or transcripts. JaaS tokens switch
  recording, streaming and transcription off.
- Room names are random UUIDs. The API never lists or exposes them, except to
  the two participants inside the join window.
- A token is valid for one room only and expires within 2 hours, never after the
  join window closes.

## Tests

- `src/modules/healthcare/video/video-provider.spec.ts` checks:
  - the JaaS header and claims, verified with a generated RSA key;
  - the 2-hour cap;
  - that a mismatched `kid` or a non-PEM key is refused.
- `test/health-video-symptoms.e2e-spec.ts` checks:
  - the window;
  - that only participants can join, and third parties get `404`;
  - that a doctor join starts the consultation;
  - status after completion;
  - clinic visits;
  - `402` for unconfirmed prepayment;
  - JaaS tokens through the real HTTP routes.
