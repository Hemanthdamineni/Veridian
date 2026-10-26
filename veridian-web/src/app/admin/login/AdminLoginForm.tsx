"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin Login Form
 *
 * Authenticates admin users by posting the token to POST /api/admin/login,
 * which sets the `admin_session` cookie server-side with HttpOnly, SameSite
 * and Secure attributes. The cookie is validated against ADMIN_TOKEN by
 * middleware on every /admin and /api/admin request.
 */
export function AdminLoginForm() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token }),
      });

      if (response.ok) {
        router.push("/admin");
        router.refresh();
      } else {
        setError(
          response.status === 401
            ? "Invalid admin token"
            : "Admin login is not configured on this deployment."
        );
      }
    } catch {
      setError("Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {error && (
        <div className="mb-5 rounded-[5px] border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-[13px] text-[var(--danger)]" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="mb-5">
          <label htmlFor="token" className="label">Admin token</label>
          <input type="password" id="token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Enter admin token" required className="field" autoComplete="off" />
        </div>
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Authenticating…" : "Sign in"}
        </button>
      </form>
    </>
  );
}
