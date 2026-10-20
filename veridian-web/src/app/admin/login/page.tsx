import { AdminLoginForm } from "./AdminLoginForm";

export const metadata = {
  title: "Curation sign-in | Veridian",
  robots: { index: false, follow: false },
};

/**
 * Admin Login Page
 *
 * The page is a server component so it can report whether the deployment
 * actually has an admin token configured. Without ADMIN_TOKEN every sign-in
 * attempt fails against an unreachable credential, which reads as a broken
 * product rather than a missing deployment setting.
 */
export default function AdminLoginPage() {
  const configured = Boolean(process.env.ADMIN_TOKEN);

  return (
    <div className="container flex min-h-[60vh] items-center justify-center py-12">
      <div className="surface w-full max-w-md p-8">
        <p className="eyebrow mb-3">Internal workspace</p>
        <h1 className="font-display text-[32px] tracking-[-.03em]">Sign in to curation</h1>
        <p className="mt-3 text-[13px] leading-6 text-[var(--muted)]">
          Enter the shared admin token to manage catalog records.
        </p>

        {configured ? (
          <div className="mt-6">
            <AdminLoginForm />
          </div>
        ) : (
          <div
            className="mt-6 rounded-[5px] border border-[var(--warning)] bg-[var(--warning-soft)] p-4 text-[13px] leading-6 text-[var(--warning)]"
            role="alert"
          >
            <p className="font-semibold">Admin access is not configured on this deployment.</p>
            <p className="mt-2">
              The <code className="font-mono text-[12px]">ADMIN_TOKEN</code> environment variable is
              not set, so no credential can be accepted. Set it to a long random value (for
              example <code className="font-mono text-[12px]">openssl rand -hex 32</code>) and
              restart the server, then sign in with that value.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
