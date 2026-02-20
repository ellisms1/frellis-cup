// src/firestore/subscribeTournament.js
import { doc, collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

/**
 * Subscribes to:
 * - tournaments/{tournamentId} (base doc)
 * - tournaments/{tournamentId}/players
 * - tournaments/{tournamentId}/days
 * - tournaments/{tournamentId}/matches
 * - tournaments/{tournamentId}/claims (optional but recommended)
 *
 * Calls onData(fullTournamentObject) whenever anything changes.
 * Returns unsubscribe().
 */
export function subscribeTournament(tournamentId, onData, onError) {
  const tRef = doc(db, "tournaments", tournamentId);

  let base = null;
  let players = [];
  let days = [];
  let matches = [];
  let claims = {};

  const emit = () => {
    if (!base) return;

    // Attach matches into the day objects (your prototype expects this)
    const daysWithMatches = (days || [])
      .slice()
      .sort((a, b) => (a.day ?? 0) - (b.day ?? 0))
      .map((d) => ({
        ...d,
        matches: (matches || [])
          .filter((m) => m.day === d.day)
          .sort((a, b) => (a.matchNo ?? 0) - (b.matchNo ?? 0)),
      }));

    onData({
      ...base,
      players,
      days: daysWithMatches,
      claims, // { uid: playerId }
    });
  };

  const unsubs = [];

  // Base doc
  unsubs.push(
    onSnapshot(
      tRef,
      (snap) => {
        base = snap.exists() ? { id: snap.id, ...snap.data() } : null;
        emit();
      },
      onError
    )
  );

  // Players
  unsubs.push(
    onSnapshot(
      collection(tRef, "players"),
      (snap) => {
        players = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        emit();
      },
      onError
    )
  );

  // Days
  unsubs.push(
    onSnapshot(
      collection(tRef, "days"),
      (snap) => {
        days = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        emit();
      },
      onError
    )
  );

  // Matches
  unsubs.push(
    onSnapshot(
      collection(tRef, "matches"),
      (snap) => {
        matches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        emit();
      },
      onError
    )
  );

  // Claims (recommended: each doc id = uid, fields: { playerId })
  unsubs.push(
    onSnapshot(
      collection(tRef, "claims"),
      (snap) => {
        const next = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          if (data?.playerId) next[d.id] = data.playerId;
        });
        claims = next;
        emit();
      },
      onError
    )
  );

  return () => unsubs.forEach((fn) => fn());
}