// src/App.jsx
import React from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";

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
    if (!fbUser?.uid) {
      setIsAdmin(false);
      return;
    }

    const adminRef = doc(db, "adminUsers", fbUser.uid);

    const unsub = onSnapshot(
      adminRef,
      (snap) => setIsAdmin(snap.exists()),
      (err) => {
        console.warn("Admin doc read failed:", err);
        setIsAdmin(false);
      }
    );

    return () => unsub();
  }, [fbUser?.uid]);

  async function doSeed({ preserveClaims: keepClaims }) {
    try {
      setSeedBusy(true);
      setSeedMsg("");

      if (!fbUser?.uid) {
        setSeedMsg("❌ You must be signed in to seed.");
        return;
      }
      if (!isAdmin) {
        setSeedMsg("❌ Only admins can seed/reseed Firestore.");
        return;
      }

      // Preserve claims best-effort
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
      tournament.ownerUserId = fbUser.uid;
      tournament.claims = keepClaims ? existingClaims || {} : {};

      await seedTournament(TOURNAMENT_ID, tournament);

      setSeedMsg(keepClaims ? "✅ Reseed successful (claims preserved)." : "✅ Reseed successful (claims cleared).");

      // refresh existence/meta
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
    if (!isAdmin) {
      setSeedMsg("❌ Only admins can seed/reseed Firestore.");
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
    <div
      style={{
        minHeight: "100vh",
        background: "#000",
        padding: 0,
        margin: 0,
        overflowX: "hidden",
      }}
    >
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
              This will overwrite tournament data in Firestore (players/days/matches reset to the seed). Live score
              entries may be lost. To continue, type <b>RESEED</b>.
            </div>

            {seedMsg ? <div style={{ marginTop: 10, fontSize: 12 }}>{seedMsg}</div> : null}

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
              <input
                type="checkbox"
                checked={preserveClaims}
                onChange={(e) => setPreserveClaims(e.target.checked)}
                disabled={seedBusy}
              />
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
                  fontWeight: 700,
                }}
                title={!canConfirmReseed ? 'Type "RESEED" to enable' : "Proceed with reseed"}
              >
                {seedBusy ? "Reseeding…" : "Yes, Reseed"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Tournament app */}
      <TournamentApp
        tournamentId={TOURNAMENT_ID}
        fbUser={fbUser}
        onOpenReseed={openSeedFlow}
        canReseed={!!fbUser?.uid && isAdmin}
        tournamentOwnerUserId={tournamentMeta?.ownerUserId || null}
      />
    </div>
  );
}
