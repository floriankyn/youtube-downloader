"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface User {
  id: string;
  email: string;
  createdAt: string;
  hasPassword: boolean;
}

// ─── Section wrapper ──────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50 divide-y divide-zinc-200 dark:divide-zinc-700">
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{title}</h2>
      </div>
      <div className="px-5 py-4 space-y-4">{children}</div>
    </div>
  );
}

// ─── Input ────────────────────────────────────────────────────

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 dark:border-zinc-600 dark:bg-zinc-900 disabled:opacity-50"
    />
  );
}

// ─── Toast ────────────────────────────────────────────────────

function Toast({ message, type }: { message: string; type: "success" | "error" }) {
  return (
    <p className={`rounded-lg px-3 py-2 text-xs ${type === "success" ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400" : "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400"}`}>
      {message}
    </p>
  );
}

// ─── Change Email ─────────────────────────────────────────────

function ChangeEmailForm({ user, onUpdate }: { user: User; onUpdate: (email: string) => void }) {
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setLoading(true);
    try {
      const res = await fetch("/api/user/email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFeedback({ msg: "Email updated successfully.", type: "success" });
      setPassword("");
      onUpdate(email);
    } catch (e) {
      setFeedback({ msg: e instanceof Error ? e.message : "Something went wrong", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="New email address" />
      {user.hasPassword && (
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Confirm with current password" />
      )}
      {feedback && <Toast message={feedback.msg} type={feedback.type} />}
      <button type="submit" disabled={loading || email === user.email}
        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
        {loading ? "Saving…" : "Update email"}
      </button>
    </form>
  );
}

// ─── Change Password ──────────────────────────────────────────

function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (newPassword !== confirmPassword) {
      setFeedback({ msg: "New passwords do not match.", type: "error" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/user/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFeedback({ msg: "Password updated successfully.", type: "success" });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (e) {
      setFeedback({ msg: e instanceof Error ? e.message : "Something went wrong", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {hasPassword && (
        <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required placeholder="Current password" />
      )}
      <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required placeholder={hasPassword ? "New password (min. 8 characters)" : "Set a password (min. 8 characters)"} minLength={8} />
      <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required placeholder="Confirm new password" />
      {feedback && <Toast message={feedback.msg} type={feedback.type} />}
      <button type="submit" disabled={loading}
        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
        {loading ? "Saving…" : hasPassword ? "Update password" : "Set password"}
      </button>
    </form>
  );
}

// ─── Delete Account ───────────────────────────────────────────

function DeleteAccountSection({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    if (confirm !== "DELETE") {
      setError('Type "DELETE" to confirm.');
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/user", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Permanently delete your account and all associated data — favorites, songs, notes, and voice recordings. This action is irreversible and complies with GDPR Article 17 (right to erasure).
      </p>
      {!showForm ? (
        <button onClick={() => setShowForm(true)}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/40 transition-colors">
          Delete my account
        </button>
      ) : (
        <form onSubmit={handleDelete} className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">This cannot be undone. Type <strong>DELETE</strong> to confirm.</p>
          {hasPassword && (
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" />
          )}
          <Input type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder='Type "DELETE"' />
          {error && <Toast message={error} type="error" />}
          <div className="flex gap-2">
            <button type="submit" disabled={loading || confirm !== "DELETE"}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
              {loading ? "Deleting…" : "Permanently delete"}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setConfirm(""); setPassword(""); setError(""); }}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Settings Page ────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (!data.user) { router.replace("/"); return; }
        setUser(data.user);
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function handleExport() {
    const a = document.createElement("a");
    a.href = "/api/user/export";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-red-500" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex flex-col items-center flex-1 px-4 py-8">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/" className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-2xl font-bold">Account settings</h1>
        </div>

        {/* Account info */}
        <Section title="Account">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">Email</span>
              <span className="font-medium">{user.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">Member since</span>
              <span className="font-medium">{new Date(user.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">Sign-in method</span>
              <span className="font-medium">{user.hasPassword ? "Email & password" : "Google"}</span>
            </div>
          </div>
        </Section>

        {/* Change email */}
        <Section title="Change email">
          <ChangeEmailForm user={user} onUpdate={(email) => setUser((u) => u ? { ...u, email } : u)} />
        </Section>

        {/* Password */}
        <Section title={user.hasPassword ? "Change password" : "Set a password"}>
          {!user.hasPassword && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Your account uses Google sign-in. You can also set a password to enable email sign-in.
            </p>
          )}
          <ChangePasswordForm hasPassword={user.hasPassword} />
        </Section>

        {/* Data & Privacy */}
        <Section title="Data & privacy">
          <div className="space-y-3">
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
                Download a copy of all your data — account info, favorites, songs, and notes — as a JSON file (GDPR Article 20).
              </p>
              <button onClick={handleExport}
                className="rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2 text-sm font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                Export my data
              </button>
            </div>
          </div>
        </Section>

        {/* Danger zone */}
        <Section title="Danger zone">
          <DeleteAccountSection hasPassword={user.hasPassword} />
        </Section>
      </div>
    </div>
  );
}
