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

  // Admin panel UI
  const [adminPanelOpen, setAdminPanelOpen] = React.useState(false);

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
      tournament.ownerUserId = fbUser.uid;

      tournament.claims = keepClaims ? existingClaims || {} : {};

      await seedTournament(TOURNAMENT_ID, tournament);

      setSeedMsg(keepClaims ? "✅ Reseed successful (claims preserved)." : "✅ Reseed successful (claims cleared).");

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
    <div className="min-h-screen bg-zinc-950">
      {/* Tournament app (public view allowed; score entry requires auth+claim inside) */}
      <TournamentApp tournamentId={TOURNAMENT_ID} fbUser={fbUser} />

      {/* Small Admin button bottom-right (only for admins) */}
      {isAdmin ? (
        <button
          onClick={() => setAdminPanelOpen(true)}
          className="fixed bottom-4 right-4 z-[60] px-4 py-2 rounded-xl bg-white text-zinc-900 font-semibold shadow-lg active:scale-[0.99]"
        >
          Admin
        </button>
      ) : null}

      {/* Admin panel (bottom sheet / modal) */}
      {adminPanelOpen ? (
        <div
          className="fixed inset-0 z-[70]"
          onClick={() => {
            if (seedBusy) return;
            setAdminPanelOpen(false);
          }}
        >
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="absolute inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center p-0 md:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full md:max-w-2xl rounded-t-3xl md:rounded-3xl bg-zinc-950 border border-white/10 shadow-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
                <div className="text-white font-semibold">Admin Tools</div>
                <button
                  onClick={() => {
                    if (seedBusy) return;
                    setAdminPanelOpen(false);
                  }}
                  className="text-white/70 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                  <div className="text-white/80 text-sm">
                    Logged in as <b>{fbUser?.email || fbUser?.uid || "—"}</b>
                  </div>

                  <div className="text-white/60 text-xs mt-1">
                    {loadingTournament ? (
                      <>Checking tournament…</>
                    ) : tournamentExists ? (
                      <>Tournament doc exists ✅</>
                    ) : (
                      <>Tournament doc missing ⚠️</>
                    )}

                    {tournamentMeta?.ownerUserId ? (
                      <>
                        {" "}
                        • Owner:{" "}
                        <span className="text-white/70">
                          {tournamentMeta.ownerUserId === fbUser?.uid ? "YOU" : tournamentMeta.ownerUserId}
                        </span>
                      </>
                    ) : null}

                    {isAdmin ? <> • You are admin ✅</> : <> • Not admin</>}
                  </div>

                  {seedMsg ? <div className="text-white/70 text-xs mt-2">{seedMsg}</div> : null}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={openSeedFlow}
                    disabled={seedBusy || !isAdmin}
                    className="flex-1 px-4 py-2 rounded-xl bg-white text-zinc-900 font-semibold disabled:bg-white/30 disabled:text-zinc-900/60"
                    title={!isAdmin ? "Only admins can seed/reseed Firestore." : "Seed tournament data into Firestore."}
                  >
                    {seedBusy ? "Seeding…" : tournamentExists ? "Reseed Firestore" : "Seed Firestore"}
                  </button>

                  {/* Sign-out is now handled by TournamentApp top-right button.
                      Keeping this out of App.jsx so you don’t get duplicate sign-out UIs. */}
                </div>

                <div className="text-white/50 text-xs">
                  Note: Sign-in / sign-out is controlled from the top-right button in the Tournament UI.
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Reseed confirmation modal */}
      {reseedOpen ? (
        <div
          onClick={() => {
            if (seedBusy) return;
            setReseedOpen(false);
          }}
          className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[520px] bg-zinc-950 border border-white/10 rounded-2xl p-4 text-white shadow-2xl"
          >
            <div className="font-extrabold text-base">Confirm Reseed</div>
            <div className="text-xs text-white/70 mt-2 leading-relaxed">
              This will overwrite tournament data in Firestore (players/days/matches reset to the seed).
              Live score entries may be lost. To continue, type <b>RESEED</b>.
            </div>

            <div className="mt-3">
              <input
                value={reseedText}
                onChange={(e) => setReseedText(e.target.value)}
                placeholder='Type "RESEED" to confirm'
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white outline-none"
                disabled={seedBusy}
              />
            </div>

            <label className="flex items-center gap-3 mt-3 text-xs text-white/80">
              <input
                type="checkbox"
                checked={preserveClaims}
                onChange={(e) => setPreserveClaims(e.target.checked)}
                disabled={seedBusy}
              />
              Preserve player claims (recommended)
            </label>

            <div className="flex gap-2 mt-4 justify-end">
              <button
                onClick={() => setReseedOpen(false)}
                disabled={seedBusy}
                className="px-4 py-2 rounded-xl border border-white/10 bg-transparent text-white disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                onClick={confirmReseed}
                disabled={seedBusy || !canConfirmReseed}
                className="px-4 py-2 rounded-xl bg-white text-zinc-900 font-bold disabled:bg-white/20 disabled:text-white/70"
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

