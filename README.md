## AI receipt scanning through Gemini (November 2026)

The SplitFair receipt scanner now sends photos to a **Supabase Edge Function** (`scan-receipt`) that calls Google's Gemini Vision API to extract merchant, purchase date, currency, final total, subtotal, fees and item lines. It fills the description and amount fields, while the user must confirm before saving. It works on mobile browsers and desktops.

**Admin setup (required before scans work):**
1. Create a Gemini API key at https://aistudio.google.com/api-keys
2. Open https://supabase.com/dashboard/project/jprqfryawhffqambonbs/settings/functions
3. Add a secret named **`GEMINI_API_KEY`** with the API key as its value. The value must not go into GitHub, `config.js`, or a website field.
4. Verify the production redirect/auth settings, open https://frickson.github.io/splitfair/, refresh, and scan a receipt while signed in.
5. If the API returns an error, check https://supabase.com/dashboard/project/jprqfryawhffqambonbs/functions for the function logs, and check Gemini API quotas/billing in Google AI Studio.

The Edge Function checks the caller's Supabase session, verifies browser origin, and uses a server-side per-user daily scan limit (20 scans per UTC day and at least 8 seconds apart). The Gemini key remains in Supabase Secrets. The browser compresses the image to JPEG before sending it to the function; the function passes it to Google for AI extraction. The image is not stored permanently by SplitFair in this workflow, but Google may process and retain it under the terms of the selected API tier; free-tier data privacy terms matter. Do not submit sensitive personal information unless you and your group members accept those terms.

This approach replaces Tesseract.js as the primary scanner. The old `receipt-ocr.js` is preserved as reference code but is no longer imported by SplitFair. Gemini API availability and free-tier quota depend on the user's Google project and model access; free does not imply unlimited. The scan does **not** create an expense until the user reviews the fields and clicks Save.

## Free receipt OCR (mobile + desktop)

SplitFair can now scan receipt photos **without paid OCR services, servers, or API keys**. In the **Add expense** form:
1. Choose **Choose receipt photo** (from gallery/files) or **Take photo** (uses the rear camera on compatible phones).
2. Tesseract.js v7 runs locally inside the browser using WebAssembly. First use downloads OCR code and English language data; allow internet access for this first download. Processing uses the user's device CPU/RAM and may take longer on slower phones.
3. The app proposes the merchant and total, shows any detected receipt date for review, and displays extracted text. Users must double-check the bill total and edit it if necessary, then choose participants and save the expense normally.
4. The original receipt photo and recognized raw text **are not uploaded to Supabase or stored with the expense** by this MVP feature. Only the ordinary expense fields are saved after the user confirms. Payment proof screenshots are a separate, optional feature with private Storage.

Supported input depends on the browser's ability to decode the photo; JPEG or PNG works best. The scanner accepts images up to 15 MB and scales them down to 1800px for memory-friendly OCR. It does not process PDFs or automatically split individual line items. OCR can confuse subtotal, tax, gratuity and amount due, particularly on blurry or non-English receipts. **Always verify before saving.**

OCR library source: [Tesseract.js](https://github.com/naptha/tesseract.js) (loaded on demand from a pinned jsDelivr CDN URL). No charges are incurred for OCR compute because processing runs on the user's device.

## Profile and settlement screenshot proof

**Edit your profile**
1. Sign in and click **My profile** in the top bar.
2. Change your display name (1–80 characters) and click **Save profile**.
3. The name is saved in Supabase Auth metadata and synchronized to all existing SplitFair group memberships. When joining another group, your saved display name is prefilled.

**Record a payment with optional screenshot**
1. Select a group and click **Record paid** on a settlement you owe.
2. Optionally choose a payment screenshot (PNG, JPEG, or WebP, max **5 MB**). The browser shows a preview.
3. Click **Confirm payment**. The screenshot uploads first to a private Supabase Storage bucket, followed by the payment database record.
4. In the group's **History**, click **View proof** on a payment to open a short-lived signed URL. Only authenticated group members can request these signed URLs. Anyone holding a signed URL can access it until it expires (currently 60 seconds).
5. Payment creators can **Undo** their payment. The app attempts to delete its associated file after deleting the payment record. If cleanup fails, a private orphaned file can remain; administrators should audit and clean up orphaned files periodically.

The private bucket is named `splitfair-payment-proofs`. Storage policies allow group members to read proofs, and a signed-in member may upload only inside `<group-id>/<their-user-id>/`. Only the uploader can remove their own proof. A server-side database constraint validates payment proof paths. Image file content is not independently malware-scanned; users should avoid sharing sensitive account details in screenshots.

**Important:** These screenshots are evidence submitted by users, not independently verified bank transactions. Recording a payment does **not** transfer money. If an image upload succeeds but the record cannot be saved, the app attempts to remove the uploaded image. Existing payments without screenshots continue to work.

## Referral links and automatic group joining

1. Sign in and select your SplitFair group.
2. Click **Generate referral link** in the group's invitation panel, then **Copy link**.
3. Send the link to your friend. The link has the form `https://frickson.github.io/splitfair/?invite=YOUR_GROUP_INVITE_CODE`.
4. Your friend opens the link and signs in with Google (or the email fallback). SplitFair remembers the invite during login, then automatically joins them to the group.
5. If your friend is already signed in, opening the link joins them automatically without an extra prompt.

The link's code is the group's existing invite code. Do not share it publicly: anyone who has it and signs in can join. Pending invitations are stored in the browser for up to 48 hours, cleared after a successful join, and may be retried after transient errors. The recipient must use the same browser and browser profile when returning from OAuth. This version does not track who referred whom or provide referral rewards.

**Browser tab logo:** `favicon.svg` is linked from `index.html`. If it doesn't appear immediately, refresh the page without cache or reopen the tab after GitHub Pages deploys the updated files.

## Google sign-in setup (required to activate the new button)

The frontend now offers **Continue with Google**. It uses Supabase OAuth and does not send email magic links.

1. Go to [Google Cloud Console → Auth Platform → Clients](https://console.cloud.google.com/auth/clients). Create or select a Google Cloud project, configure the OAuth consent screen (External; add test users while in Testing), and create a **Web application** OAuth client.
2. Set **Authorized JavaScript origins** to `https://frickson.github.io`.
3. Set **Authorized redirect URIs** to **`https://jprqfryawhffqambonbs.supabase.co/auth/v1/callback`**. This is the Google → Supabase callback, **not** your GitHub Pages URL.
4. In [Supabase Authentication → Providers](https://supabase.com/dashboard/project/jprqfryawhffqambonbs/auth/providers), open **Google**, enable it, paste the Google OAuth **Client ID and Client Secret**, and save. Keep the secret only in Supabase / Google Cloud; **never commit it to GitHub**.
5. In [Supabase Authentication → URL Configuration](https://supabase.com/dashboard/project/jprqfryawhffqambonbs/auth/url-configuration), set **Site URL** to `https://frickson.github.io/splitfair/` and add that exact URL to **Redirect URLs**. Remove localhost as the Site URL.
6. Open [SplitFair](https://frickson.github.io/splitfair/), refresh, choose **Continue with Google**, and test using a permitted Google account. For broad access, finish Google's OAuth app publication / verification requirements.

If the Google provider isn't configured, the button won't work yet. Email magic link remains an optional fallback subject to Supabase SMTP email limits.

## Live deployment state (4 November 2026)

- GitHub repository: https://github.com/Frickson/splitfair
- Supabase project ID: `jprqfryawhffqambonbs` (Singapore)
- Database migrations applied: `create_splitfair_schema`, `restrict_splitfair_function_access`
- Database tables exist with RLS; browser-safe credentials are configured in `config.js`.
- Configure GitHub Pages under repository **Settings → Pages → Deploy from a branch → main → /(root)**.
- Configure Supabase **Authentication → URL Configuration**: Site URL `https://frickson.github.io/splitfair/` and redirect allow list `https://frickson.github.io/splitfair/**`.
- After Google OAuth client/provider and Pages redirects are configured, test login with two separate Google accounts. Email fallback remains rate-limited.

The schema deployed on Supabase is the current source of truth. If restoring from older downloaded ZIP files, include the `restrict_splitfair_function_access` migration.

# SplitFair Cloud — GitHub Pages + Supabase

A browser-based Splitwise-style shared-expense application. Includes Google OAuth login (plus optional email magic-link authentication), shared groups using invite codes, equal/exact/percentage splits, balances, simplified settlements, payment history, and Supabase Realtime updates. Currency is per group (no FX conversion).

## 1. Create your database

1. Create a **new Supabase project** at https://supabase.com/dashboard.
2. Open **SQL Editor**, paste the complete contents of `schema.sql`, and run it once. This creates tables, restricted-access RPC functions, validation triggers, RLS policies, and Realtime publications.
3. In **Authentication → Providers**, enable Email (with OTP/magic-link). Configure outbound email/SMTP for real-world multiuser use; Supabase's default email service has limitations.
4. In **Authentication → URL Configuration**, set Site URL to `https://Frickson.github.io/splitfair/` and add `https://Frickson.github.io/splitfair/**` in Redirect URLs. If using a different repo, update the URL accordingly.
5. In **Project Settings → API / API Keys**, copy the **Project URL** and **publishable** key (or legacy **anon** key). **Never use the service_role key or a secret API key in browser code.**

## 2. Deploy to GitHub Pages

1. Create a **public** repository named `splitfair` under `Frickson` (or use your own GitHub account).
2. Upload `index.html`, `app.js`, `config.js` (plus `schema.sql` and this README if desired) into the repository's `main` branch root.
3. Optional: set `url` and `anonKey` in `config.js` so your visitors won't see a setup form. These are **public** project credentials (safe to expose when RLS is configured).
4. In GitHub repository **Settings → Pages**, set Source to **Deploy from a branch**, select `main` and `/ (root)`, and save.
5. Open `https://frickson.github.io/splitfair/` once GitHub Pages is live.
6. If `config.js` wasn't populated, enter the project URL and publishable key once in the web app. Each browser needs those values unless you preconfigure `config.js`.

**GitHub Pages cannot host PostgreSQL or a server.** GitHub Pages serves the frontend; Supabase provides the database and authentication.

## Important security and operating notes

- Group data is stored in Supabase, with RLS: only signed-in group members can read it. Members may create expenses; only the person shown as paying a settlement may record that payment. Expense and payment creators may delete their own records, and expense creators may edit their own records.
- Invite codes are sensitive: anyone who knows a code and has an account can join a group. The current version has no invite-code rotation, moderation or rate-limit for guessing; codes are high-entropy random values. Do not expose invite codes publicly.
- Expense totals and participants are checked on the server. Amounts are integer cents. Payments are recorded entries, **not** bank transfers.
- This is an MVP. It has no email invitations, expense receipt uploads, expense categories, multi-currency conversions, or offline write queue.
- Realtime messages refresh client state; if realtime isn't available use **Refresh**.
- For a production public service, add abuse prevention, monitoring, backups, account deletion and privacy policy.
- Opening `index.html` using `file://` may fail due to browser module/CORS restrictions. Serve it through GitHub Pages or a local HTTP server (`python3 -m http.server 8000`).

## Test flow

1. Sign in with User A, create a group, note its invite code.
2. In a second browser, sign in with User B and join via code.
3. User A adds a $90 bill paid by A, shared equally between A and B.
4. Both users should see B owes A $45.00.
5. User B clicks **Record paid** (the payer must confirm the settlement). Both balances should return to zero.
6. Verify an uninvited account cannot select another group's rows directly using Supabase client/API.