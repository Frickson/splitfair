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
- This is an MVP. It has no email invitations, receipt uploads, expense categories, multi-currency conversions, or offline write queue.
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