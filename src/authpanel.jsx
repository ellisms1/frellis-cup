import React, { useMemo, useState } from "react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebase";

export default function AuthPanel() {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const canSubmit = useMemo(() => {
    return email.trim().length > 3 && pw.length >= 6 && !loading;
  }, [email, pw, loading]);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email.trim(), pw);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), pw);
      }
      // App.jsx listens to auth state; it will switch views automatically.
    } catch (e2) {
      setErr(e2?.message || "Auth error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "64px auto", padding: 24, border: "1px solid #ddd", borderRadius: 12 }}>
      <h2 style={{ margin: 0 }}>Frellis Cup</h2>
      <p style={{ marginTop: 8, color: "#555" }}>
        {mode === "signup" ? "Create your account" : "Sign in to continue"}
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => setMode("signin")}
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 10,
            border: "1px solid #ddd",
            background: mode === "signin" ? "#111" : "#fff",
            color: mode === "signin" ? "#fff" : "#111",
            cursor: "pointer",
          }}
          type="button"
        >
          Sign in
        </button>
        <button
          onClick={() => setMode("signup")}
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 10,
            border: "1px solid #ddd",
            background: mode === "signup" ? "#111" : "#fff",
            color: mode === "signup" ? "#fff" : "#111",
            cursor: "pointer",
          }}
          type="button"
        >
          Sign up
        </button>
      </div>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#444" }}>Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            type="email"
            style={{ padding: 12, borderRadius: 10, border: "1px solid #ddd" }}
            autoComplete="email"
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#444" }}>Password</span>
          <input
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="6+ characters"
            type="password"
            style={{ padding: 12, borderRadius: 10, border: "1px solid #ddd" }}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
        </label>

        {err ? <div style={{ color: "crimson", fontSize: 12 }}>{err}</div> : null}

        <button
          disabled={!canSubmit}
          style={{
            padding: 12,
            borderRadius: 10,
            border: "1px solid #111",
            background: canSubmit ? "#111" : "#999",
            color: "#fff",
            cursor: canSubmit ? "pointer" : "not-allowed",
            marginTop: 6,
          }}
        >
          {loading ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>

        <div style={{ fontSize: 12, color: "#666" }}>
          Note: Email/Password Auth must be enabled in Firebase Console → Authentication → Sign-in method.
        </div>
      </form>
    </div>
  );
}
