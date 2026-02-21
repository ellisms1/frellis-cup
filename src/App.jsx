// src/App.jsx
import React from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";

import AuthGate from "./auth";
import TournamentApp, { makeInitialTournament } from "./TournamentApp";
import { seedTournament } from "./seedTournament";

const TOURNAMENT_ID = "frellis-cup-2026";

export default function App() {
  const [fbUser, setFbUser] = React.useState(null);
  const [authReady, setAuthReady] = React.useState(false);

  const [loadingTournament, setLoadingTournament] = React.useState(true);
  const [tournamentExists, setTournamentExists] = React.useState(false);

  const [tournamentMeta, setTournamentMeta] = React.useState(null); // { ownerUserId }
  const [isAdmin, setIsAdmin] = React.useState(false);

  const [seedBusy, setSeedBusy] = React.useState(false);
  const [seedMsg, setSeedMsg] = React.useState("");

  // Reseed protection UI
  const [reseedOpen, setReseedOpen] = React.useState(false);
  const [reseedText, setReseedText] = React.useState("");
  const [preserveClaims, setPreserveClaims] = React.useState(true);

  // Auth listener
  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setFbUser(u || null);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Tournament existence + meta (public readable)
  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoadingTournament(true);
      try {
        const tRef = doc(db, "tournaments", TOURNAMENT_ID);
        const snap = await getDoc(tRef);
        if (cancelled) return;

        const exists = snap.exists();
        setTournamentExists(exists);

        if (exists) {
          const data = snap.data() || {};
          setTournamentMeta({ ownerUserId: data.ownerUserId || null });
        } else {
          setTournamentMeta(null);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setTournamentExists(false);
          setTournamentMeta(null);
        }
      } finally {
        if (!cancelled) setLoadingTournament(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  // Admin detection (adminUsers/{uid})
  React.useEffect(() => {
    // Signed-out = not admin
    if (!fbUser?.uid) {
      setIsAdmin(false);
      return;
    }

    const adminRef = doc(db, "adminUsers", fbUser.uid);

    // Subscribe so it flips instantly when you add/remove admin doc
    const unsub = onSnapshot(
      adminRef,
      (snap) => {
        setIsAdmin(snap.exists());
      },
      (err) => {
        console.warn("Admin doc read failed:", err);
        setIsAdmin(false);
      }
    );

    return () => unsub();
  }, [fbUser?.uid]);

  const isOwner = !!fbUser?.uid && !!tournamentMeta?.ownerUserId && tournamentMeta.ownerUserId === fbUser.uid;

  async function doSeed({ preserveClaims: keepClaims }) {
    try {
      setSeedBusy(true);
      setSeedMsg("");

      if (!fbUser?.uid) {
        setSeedMsg("❌ You must be signed in to seed.");
        return;
      }

      // IMPORTANT: owner-only gate (not just admin)
      if (!isOwner) {
        setSeedMsg("❌ Only the OWNER can seed/reseed Firestore.");
        return;
      }

      // If preserving claims, read them first (best-effort)
      let existingClaims = {};
      try {
        const snap = await getDoc(doc(db, "tournaments", TOURNAMENT_ID));
        if (snap.exists()) {
          const data = snap.data() || {};
          existingClaims = data.claims && typeof data.claims === "object" ? data.claims : {};
        }
      } catch (e) {
        console.warn("Could not read existing claims (continuing):", e);
      }

      const tournament = makeInitialTournament();

      // Store owner for display (admin privileges come from adminUsers/{uid})
      tournament.ownerUserId = fbUser.uid;

      if (keepClaims) {
        tournament.claims = existingClaims || {};
      } else {
        tournament.claims = {};
      }

      await seedTournament(TOURNAMENT_ID, tournament);

      setSeedMsg(keepClaims ? "✅ Reseed successful (claims preserved)." : "✅ Reseed successful (claims cleared).");

      // Recheck existence after seeding
      const snap = await getDoc(doc(db, "tournaments", TOURNAMENT_ID));
      setTournamentExists(snap.exists());
      if (snap.exists()) {
        const data = snap.data() || {};
        setTournamentMeta({ ownerUserId: data.ownerUserId || null });
      }
    } catch (e) {
      console.error(e);
      setSeedMsg(`❌ Seed failed: ${e?.message || String(e)}`);
    } finally {
      setSeedBusy(false);
    }
  }

  function openSeedFlow() {
    if (!fbUser?.uid) {
      setSeedMsg("❌ You must be signed in to seed.");
      return;
    }

    // IMPORTANT: owner-only gate (not just admin)
    if (!isOwner) {
      setSeedMsg("❌ Only the OWNER can seed/reseed Firestore.");
      return;
    }

    // First-time seed: no confirmation needed
    if (!tournamentExists) {
      doSeed({ preserveClaims: false });
      return;
    }

    // Existing tournament: require confirmation modal
    setReseedText("");
    setPreserveClaims(true);
    setReseedOpen(true);
  }

  async function confirmReseed() {
    await doSeed({ preserveClaims });
    setReseedOpen(false);
    setReseedText("");
  }

  if (!authReady) return null;

  const canConfirmReseed = reseedText.trim().toUpperCase() === "RESEED";

  return (
    // Add bottom padding so the fixed bar doesn't cover content
    <div style={{ padding: 16, paddingBottom: fbUser ? 110 : 16 }}>
      {/* Tournament app (public view allowed; score entry requires auth+claim inside) */}
      <TournamentApp tournamentId={TOURNAMENT_ID} fbUser={fbUser} />

      {/* Fixed bottom admin bar (only shows if signed in) */}
      {fbUser ? (
        <div
          style={{
            position: "fixed",
            left: 16,
            right: 16,
            bottom: 16,
            zIndex: 9998,
            maxWidth: 980,
            margin: "0 auto",
          }}
        >
          <div
            style={{
              padding: 12,
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              background: "rgba(0,0,0,0.55)",
              backdropFilter: "blur(10px)",
              color: "white",
              boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, letterSpacing: 0.2 }}>Admin Tools</div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2, lineHeight: 1.35 }}>
                Logged in as <b>{fbUser.email || fbUser.uid}</b>
                {loadingTournament ? <> • Checking tournament…</> : tournamentExists ? <> • Tournament doc exists ✅</> : <> • Tournament doc missing ⚠️</>}
                {tournamentMeta?.ownerUserId ? (
                  <>
                    {" "}
                    • Owner:{" "}
                    <span style={{ opacity: 0.9 }}>
                      {tournamentMeta.ownerUserId === fbUser.uid ? "YOU" : tournamentMeta.ownerUserId}
                    </span>
                  </>
                ) : null}
                {isAdmin ? <> • You are admin ✅</> : <> • Not admin</>}
                {isOwner ? <> • You are owner 👑</> : null}
              </div>

              {seedMsg ? <div style={{ fontSize: 12, marginTop: 6 }}>{seedMsg}</div> : null}
            </div>

            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {/* Owner-only reseed button */}
              {isOwner ? (
                <button
                  onClick={openSeedFlow}
                  disabled={seedBusy}
                  title="Owner-only: seed/reseed Firestore."
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "white",
                    color: "#0b0b0f",
                    cursor: seedBusy ? "not-allowed" : "pointer",
                    fontWeight: 800,
                  }}
                >
                  {seedBusy ? "Seeding…" : tournamentExists ? "Reseed Firestore" : "Seed Firestore"}
                </button>
              ) : null}

              <button
                onClick={() => signOut(auth)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "transparent",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : (
        // If signed out, show your auth gate (you mentioned you’ve been polishing this already)
        <AuthGate />
      )}

      {/* Reseed confirmation modal */}
      {reseedOpen ? (
        <div
          onClick={() => {
            if (seedBusy) return;
            setReseedOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 520,
              background: "#0b0b0f",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16,
              padding: 16,
              color: "white",
              boxShadow: "0 20px 80px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 16 }}>Confirm Reseed</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 8, lineHeight: 1.4 }}>
              This will overwrite tournament data in Firestore (players/days/matches reset to the seed). Live score entries may be
              lost. To continue, type <b>RESEED</b>.
            </div>

            <div style={{ marginTop: 12 }}>
              <input
                value={reseedText}
                onChange={(e) => setReseedText(e.target.value)}
                placeholder='Type "RESEED" to confirm'
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  outline: "none",
                }}
                disabled={seedBusy}
              />
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, fontSize: 12, opacity: 0.9 }}>
              <input type="checkbox" checked={preserveClaims} onChange={(e) => setPreserveClaims(e.target.checked)} disabled={seedBusy} />
              Preserve player claims (recommended)
            </label>

            <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button
                onClick={() => setReseedOpen(false)}
                disabled={seedBusy}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "transparent",
                  color: "white",
                  cursor: seedBusy ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>

              <button
                onClick={confirmReseed}
                disabled={seedBusy || !canConfirmReseed}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: seedBusy || !canConfirmReseed ? "rgba(255,255,255,0.2)" : "white",
                  color: seedBusy || !canConfirmReseed ? "rgba(255,255,255,0.7)" : "#0b0b0f",
                  cursor: seedBusy || !canConfirmReseed ? "not-allowed" : "pointer",
                  fontWeight: 800,
                }}
                title={!canConfirmReseed ? 'Type "RESEED" to enable' : "Proceed with reseed"}
              >
                {seedBusy ? "Reseeding…" : "Yes, Reseed"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

