"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin Login Page
 *
 * Authenticates admin users by setting a session cookie.
 * The cookie value is validated against ADMIN_TOKEN by middleware.
 */
export default function AdminLoginPage() {
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
      document.cookie = `admin_session=${token}; path=/; max-age=86400; SameSite=Strict; Secure`;

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
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="bg-white border border-zinc-200 rounded-xl p-8">
          <h1 className="text-2xl font-bold text-zinc-900 mb-2">Admin Login</h1>
          <p className="text-zinc-500 mb-6">
            Enter the admin token to access the management panel.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label
                htmlFor="token"
                className="block text-sm font-medium text-zinc-700 mb-2"
              >
                Admin Token
              </label>
              <input
                type="password"
                id="token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Enter admin token"
                required
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Authenticating..." : "Login"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
