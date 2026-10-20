# Direct Cloudinary video uploads — release and operations

## Release status

This change is implemented locally. Production was not contacted, deployed, restarted, or migrated. No production settings were changed and no Cloudinary test assets were uploaded. Enable only after the operator checks below and staging QA. The account's actual 2 GB allowance is unknown.

## Changes

- `src/modules/upload/direct-video.controller.ts`: signed authorization, student target/enrollment checks, provider verification, readiness polling and cancellation.
- `direct-video.policy.ts`: exact request allowlist, 2 GiB target, format and actual asset validation.
- `direct-video-link.middleware.ts` and `src/app.ts`: verify new namespace links before existing mutation handlers; reject cross-student and wrong-task attachment; preserve historical URL behavior.
- `direct-video-record.ts`: PostgreSQL transaction and intent row lock to make new Gallery, Student Corner and practice-submission record creation idempotent. Existing assignment upserts remain in place. Notifications can still repeat when a submission request is retried.
- `src/modules/gallery/gallery.controller.ts`, `student-corner/student-corner.controller.ts`, `video/video.controller.ts`: use that record helper.
- `prisma/schema.prisma` and `prisma/migrations/20261020120000_direct_video_intents/migration.sql`: additive `VideoUploadIntent`, foreign key, size/status checks, unique destination/asset/playback URL, owner/status indexes, verified metadata, processing state and record links. Deleting a user sets the intent owner to null, preserving metadata for existing media without blocking the existing user-delete workflow; ownerless intents cannot complete. Float stores exact integers through this size range; 2 GiB exceeds Prisma Int's signed int32 range. No old models, rows or assets are migrated or deleted.
- `upload.routes.ts`: existing authentication and staff permissions preserved; distinct student initialization retains STUDENT plus active-access middleware. Legacy video/image routes cap each file at 25 MiB, one file/request, with at most two concurrent buffered requests per Node process. Public profile images retain 50 MiB but now accept one file. Leave/letterhead routes keep their own limits and share the concurrency gate.
- Frontend `lib/directVideoUpload.ts`: 10 MiB REST chunks, three attempts per transient chunk, one active video per browser module, progress, safe cancellation, completion polling. A scoped request adapter preserves existing XHR form callbacks; no global browser APIs are modified. `lib/api.ts` redirects its existing video helpers to this flow.
- `components/VideoUploadStatus.tsx` and `app/layout.tsx`: responsive transfer/processing indicator and cancellation. Pending transferred uploads can be checked after reload; recovered student files return to the matching task form, staff can copy the recovered URL.
- Updated forms: course create/edit and CourseView; Admin Recorded Class (through its shared helper); Admin/Teacher Assignments; Teacher video references; student assignments/practice; Gallery; Student Corner; Hero Banner; performance settings and Content Library (through shared API); exam question media. Mixed assignment references now upload sequentially with separate URLs. Audio/documents continue through the bounded image/general-media endpoint.
- New backend and frontend upload test scripts. Existing image, leave attachment, profile, letterhead and old playback paths remain available.

## API contract

All paths are relative to `/api/v1` and use the existing portal bearer token or HttpOnly cookie.

- `POST /upload/video/intents`: staff; body `{name,mimeType,size,purpose:"STAFF_MEDIA"}`.
- `POST /upload/student/video/intents`: students; body `{name,mimeType,size,purpose:"ASSIGNMENT"|"PRACTICE",relatedId}`. IDs are resolved in the database; owner comes from authentication.
- `POST /upload/video/intents/:id/complete` and student equivalent: body `{}`. No public ID, URL, role, owner or provider metadata is accepted from the caller. Only the owner may complete. Returns UPLOADING/PROCESSING/READY/FAILED and verified playback URLs only at READY.
- `DELETE /upload/video/intents/:id` and student equivalent: invalidates an unfinished owned intent. Cancellation does not delete an asset while an issued signature is usable.

Initialization: 12 requests per authenticated user per 15 minutes. Completion: 30 per minute. These use the existing package's process-local memory store; a multi-instance deployment needs a shared rate-limit store. Completion rechecks Cloudinary at most once per minute for an already-processing intent; frontend polls every 10 seconds for up to 30 minutes. Cloudinary Admin API quotas must be monitored.

## Configuration and Cloudinary checks — operator action required

Existing backend-only `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` remain required. Add the following through the normal production configuration process only after approval:

```dotenv
CLOUDINARY_VIDEO_SIGNED_PRESET=kathak_direct_signed
# Use the VERIFIED ACCOUNT limit in bytes, at most 2147483648, not a requested plan upgrade.
CLOUDINARY_VIDEO_MAX_BYTES=2147483648
# Set true only after verifying the account-level upload cap below.
CLOUDINARY_VIDEO_ACCOUNT_LIMIT_CONFIRMED=true
```

No new frontend environment variables or JWT-bearing upload URLs are required. Keep the normal public API base URL configuration.

1. Check Cloudinary Console Settings / Usage Limits or obtain confirmation from Cloudinary Support that the account accepts the intended maximum VIDEO original, including 2 GiB if desired. If the account cap is 100 MB, use its actual byte value. Leave confirmation unset until verified. A value in our environment is an operator attestation, not an API-discovered account entitlement. Presets do **not** support a per-preset file-size cap. Do not configure an invented `max_file_size` preset option.
2. Configure a **signed** preset named above. Set allowed formats to `mp4,mov,webm,m4v`; no incoming transformations, renaming, moderation, automatic add-ons, default folder prefix, public ID changes, or resource access changes. The backend checks that this preset is signed and restricts formats; it supplies a random `kathak_direct/<authenticated-user>/<intent>` destination, `overwrite=false`, delivery type `upload` and asynchronous H.264/AAC MP4 eager transformation. Test both fixed-folder and dynamic-folder account behavior in staging: a changed public ID fails verification.
3. Cloudinary enforces its account cap during transfer; backend validates the declared size before signing and exact actual bytes/format/video type after upload. A dishonest client can transfer more than its declared size up to the Cloudinary account limit before verification rejects it. If a hard storage-side 2 GiB cap is required, confirm that the account itself is capped at or below it; this cannot be implemented with a browser widget or preset. Never treat client validation as security.
4. Standard Cloudinary upload signatures stay valid for one hour and do not sign the URL's resource-type segment. Our intents expire after 55 minutes, enforce owner completion, unique random destinations and no overwrites; expiry/cancellation cannot revoke the issued provider signature. Restrict other upload types/account capabilities where available and monitor rejected/orphan uploads. A signature may still transfer an asset after intent cancellation, but cannot complete/link it through this application.
5. Confirm asynchronous eager video transformations and codecs are available, and authorize the exact eager transformation under Strict Transformations if enabled. REST eager string: `vc_h264,ac_aac/f_mp4`. Polling queries authenticated Admin API resource details and waits for the matching derived MP4. Missing derivatives remain PROCESSING; provider-reported failures or a processing age over 24 hours become FAILED on the next verification. Test the account's actual derived-resource representation in staging.
6. The browser must reach `https://api.cloudinary.com`; any deployment CSP needs that origin in `connect-src`. Allow Cloudinary's normal CORS handling of `Content-Range` and `X-Unique-Upload-Id`. Portal tokens, cookies and API secret are never sent there.
7. No webhook endpoint is added: readiness is determined by verified backend polling. No unsigned webhook data is trusted.

## Playback and compatibility assessment

Current paid recorded classes use API enrollment/batch checks but return public Cloudinary URLs. This release retains that behavior for compatibility; possession of a public URL permits playback outside the portal. H.264/AAC MP4 is generated asynchronously for MOV/HEVC interoperability; original records and URLs are preserved.

Authenticated/private originals and expiring delivery require a separate coordinated change across recorded-class serializers, every player, download/preview endpoints and CDN policy. Merely signing a public URL does not make that asset private. Do not switch account-wide media access settings as part of this deployment. Historical/external URLs keep their existing trust/access behavior; new namespace links are verified.

Legacy upload requests now need one file per request and reject files over 25 MiB. All discovered new video callers use direct upload; older mobile/integrations may still call legacy endpoints and receive that error. Existing clients that sent multiple files in a single request must be updated. No route was removed. Each Node worker permits two buffered uploads; account for worker count in RAM budgeting. No heap increase is needed.

The upload widget was evaluated: the application already has many custom file pickers, progress callbacks, mixed references and previews. The documented browser REST chunk protocol preserves these without adding an external widget/runtime or a new UI framework.

## Safe deployment commands

Prepare an ordinary reviewed release commit in both repositories. The local frontend is `Kathak`; its actual production deployment directory/hosting is not supplied. The backend path `~/Kathak-Backend` comes from the request. Do not run `prisma db push`, `migrate reset`, or unreviewed schema regeneration against production.

First run in a staging deployment with its own database and Cloudinary product environment:

```bash
cd ~/Kathak-Backend
npm ci
npx prisma validate
npx prisma generate
npm run test:uploads
npx prisma migrate status
# Review the SQL migration, back up the target database, then apply only with operator authorization:
npx prisma migrate deploy
npm run build
```

Use the database provider's snapshot/backup operation, or an approved `pg_dump --format=custom --file=before-direct-video.dump` against the target URL without printing credentials. Store the backup outside the web root. Check **all** pending migrations before `migrate deploy`: it applies every pending migration, not just this one. Resolve existing migration drift in staging first.

After staging QA, repeat the authorized migration/build steps for production with the appropriate environment. Publish the backend before the matching frontend. Backend settings must be ready before the new frontend is published, otherwise video initialization returns a friendly 503. Small legacy uploads remain available.

```bash
# On the actual frontend build host, set FRONTEND_DIR to its real deployed checkout:
cd "$FRONTEND_DIR"
npm ci
npm run test:uploads
npx tsc --noEmit
npm run lint
npm run build
```

The production build host needs access to Google Fonts because the existing app uses `next/font/google`. No existing deployment supervisor configuration was found. Use the existing release pipeline; if PM2 manages these services, inspect `pm2 list`, then set `BACKEND_PM2_NAME` and `FRONTEND_PM2_NAME` to the real names before running:

```bash
pm2 reload "$BACKEND_PM2_NAME" --update-env
# Only if the frontend is also a PM2-managed process:
pm2 reload "$FRONTEND_PM2_NAME" --update-env
```

For a systemd deployment, use `sudo systemctl restart "$BACKEND_SERVICE"` with the actual existing unit instead. These commands are operator instructions, not commands executed by Codex. No service names are invented.

Nginx: the direct transfer bypasses Nginx; `client_max_body_size 2048M` is unnecessary for this flow. Leave unrelated production config unchanged. If reducing it later, inspect all existing clients and keep at least the largest retained attachment/template request plus multipart overhead. No Nginx reload is needed for this code change; if an approved config change is made, run `sudo nginx -t` before `sudo systemctl reload nginx`.

Rollback: restore the previous reviewed frontend/backend release and their approved environment settings through the normal deployment system. Keep the additive intent table and existing new assets/records; do not drop data or roll the database backward. Prefer retaining the legacy memory cap as a hotfix because the old backend's 2 GiB memory upload is unsafe. Existing direct URLs already saved remain normal Cloudinary URLs. Issued provider signatures remain usable until provider expiry even if authorization is disabled. Take account of that before orphan cleanup.

## Manual staging QA and operational confirmation

- Test 20 MB, 100 MB, 250 MB, 500 MB, 1 GB and 2 GB only where the confirmed staging account permits. Test one byte over the app cap and account cap, zero-byte files, wrong extension/MIME, renamed non-video content, expired authorization, rejected provider signatures and quota errors. Do not upload large production assets without approval.
- Test Admin course create/edit, recorded classes, assignment references, gallery, Student Corner and banners; Teacher assignment/practice references; Student assignment and practice uploads. Verify images/PDF/audio references, profile photos, public enrollment images, leave evidence and letterhead templates still work within their documented caps.
- Test batch mismatch, inactive/expired enrollment, overdue access lock, closed assignment/deadline, a task belonging to another course, a changed student ID in request JSON, guessed intent IDs, another user's completion and linking a ready video to a different task. Verify historical videos still play.
- Repeat completion concurrently and retry a gallery/practice create request against a real staging PostgreSQL database: one upload metadata row and one linked record should remain. The mocked tests cover transaction/locking intent but do not replace real PostgreSQL concurrency QA. Assignment submissions retain their existing unique `(assignmentId,studentId)` upsert. Record distribution to multiple batches remains intentional existing behavior.
- Interrupt a middle chunk; verify retry keeps the same upload ID/range. Cancel; verify no record can be linked afterward. Retry by selecting the file again (new intent). Refresh during processing, click Check processing, then finish the form. Verify matching student task recovery. Partial transfer resume after reload is not implemented; transfer must restart. One pending transferred upload is recoverable per browser profile.
- Test MOV/HEVC from an iPhone and MP4/WEBM in Chrome, Safari, iPhone Safari, Android and desktop. Confirm transfer reaches Uploaded/100% before transcoding finishes, then Ready; do not save a processing URL. Test terminal processing failures and unavailable Cloudinary Admin API.
- Verify multiple-file assignment references each retain their own correct name, URL and type. Verify cancel and duplicate clicks leave no duplicate gallery/submission records. When reusing an already-linked practice upload unchanged, its existing submission is returned.
- In DevTools Network, enable Preserve log and upload an approved 500 MB+ staging video. There should be roughly 10 MiB POST bodies sent to `api.cloudinary.com/v1_1/<cloud>/video/upload`, with increasing `Content-Range` and one `X-Unique-Upload-Id`. Inspect that these requests carry neither portal Authorization nor portal cookies. Backend calls should only be small JSON init/completion requests; no video multipart POST should target the VPS.
- While uploading, monitor VPS `pm2 monit` or the existing service monitor, `free -m`, and API latency. Check Nginx/backend access logs for only small intent requests; if the configured log format includes `$request_length`, their total request sizes should stay small. VPS RAM/network traffic should not scale with the video byte count. Cloudinary transcode computation occurs off the VPS.
- Monitor Cloudinary upload/transform/Admin API quotas. After at least two hours beyond expiry, review expired/cancelled/unlinked `kathak_direct/` intents against provider assets and references before manually cleaning only those assets. Do not delete historical media or remove ready linked intents. No automatic destructive cleanup runs in this release.

## Verification record

Executed locally on 20 October 2026:

- Backend TypeScript build: passed. Prisma Client generation and schema validation: passed.
- Backend upload tests: 25 passed. Frontend upload tests: 8 passed. Existing live-media suite: 3 passed.
- Frontend TypeScript check: passed. Targeted lint for the new upload client/status component, shared API helper and browser upload tests: passed.
- Full repository lint: fails on existing issues (358 errors on the initial run). A baseline comparison of changed TypeScript files reports 61 errors at HEAD and 60 with this change; no affected file gained errors.
- Next.js optimized production build: attempted and failed fetching the application's existing Google Fonts in this network-restricted environment. This build is not claimed successful.
- Both repository diffs pass whitespace checks. Reviewed changed/new files; environment/credential files were not changed. No database migration, production service restart or production upload was executed.

Tests use synthetic credentials and mocked Cloudinary/database calls; no production assets or DB connections are needed. Backend requests invoke Express in process so they also work where local TCP connections are blocked. Actual migration application, database row-lock concurrency, provider account behavior and the browser/device/large-file matrix remain staging release gates.

Documentation checked during implementation:

- [Manual browser chunking and signature validity](https://cloudinary.com/documentation/upload_images)
- [Browser upload protocol](https://cloudinary.com/documentation/client_side_uploading)
- [Preset restrictions, including absence of per-preset size limits](https://cloudinary.com/documentation/upload_presets)
- [Asynchronous eager transformations](https://cloudinary.com/documentation/eager_and_incoming_transformations)
- [Provider-side resource verification](https://cloudinary.com/documentation/admin_api)
- [Private/authenticated media access](https://cloudinary.com/documentation/control_access_to_media)
