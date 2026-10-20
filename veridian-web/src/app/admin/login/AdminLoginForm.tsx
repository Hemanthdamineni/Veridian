"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin Login Form
 *
 * Authenticates admin users by setting a session cookie.
 * The cookie value is validated against ADMIN_TOKEN by middleware.
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
      // Set session cookie
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `admin_session=${encodeURIComponent(token)}; path=/; max-age=86400; SameSite=Strict${secure}`;

      // Verify by making a test request
      const response = await fetch("/api/admin/skus", {
        method: "GET",
        credentials: "include",
      });

      if (response.ok) {
        router.push("/admin");
        router.refresh();
      } else {
        // Clear invalid cookie
        document.cookie = "admin_session=; path=/; max-age=0";
        setError("Invalid admin token");
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
