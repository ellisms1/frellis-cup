/// src/seedTournament.js
import {
  doc,
  setDoc,
  writeBatch,
  collection,
  getDocs,
  query,
  limit,
} from "firebase/firestore";
import { db } from "./firebase";

function assertId(label, id, context = {}) {
  if (typeof id !== "string" || id.trim().length === 0) {
    console.error("BAD ID:", { label, id, context });
    throw new Error(`${label} id is invalid (${String(id)}). Check console for context.`);
  }
  if (id.includes("/")) {
    throw new Error(`${label} id cannot include "/": ${id}`);
  }
}

export async function seedTournament(tournamentId, tournament, opts = {}) {
  const { includeProofDocs = false } = opts;

  assertId("tournament", tournamentId);

  if (!tournament || typeof tournament !== "object") {
    throw new Error("tournament is missing/invalid (makeInitialTournament returned bad data).");
  }

  const tRef = doc(db, "tournaments", tournamentId);

  // Base doc
  await setDoc(
    tRef,
    {
      name: tournament.name ?? "Frellis Cup",
      subtitle: tournament.subtitle ?? "",
      established: tournament.established ?? null,
      ownerUserId: tournament.ownerUserId ?? null,
      adminUserIds: Array.isArray(tournament.adminUserIds) ? tournament.adminUserIds : [],
      claims: tournament.claims || {},
      courses: tournament.courses || {},
      updatedAt: Date.now(),
    },
    { merge: true }
  );

  const players = Array.isArray(tournament.players) ? tournament.players : [];
  const days = Array.isArray(tournament.days) ? tournament.days : [];

  // ---- Batch size guard (Firestore max 500 writes per batch) ----
  // Writes:
  // - optional proof docs (3)
  // - players (N)
  // - days (D)
  // - matches (sum over all days)
  const matchCount = days.reduce((sum, d) => sum + (Array.isArray(d?.matches) ? d.matches.length : 0), 0);
  const proofWrites = includeProofDocs ? 3 : 0;
  const totalWrites = proofWrites + players.length + days.length + matchCount;

  if (totalWrites > 450) {
    // keep a buffer under 500 in case you add more writes later
    throw new Error(
      `Seed too large for a single batch (${totalWrites} writes). Reduce size or split into multiple batches.`
    );
  }

  const batch = writeBatch(db);
    // Cleanup legacy proof docs (prevents Day 999 from lingering)
  batch.delete(doc(collection(tRef, "players"), "proof_player"));
  batch.delete(doc(collection(tRef, "days"), "proof_day"));
  batch.delete(doc(collection(tRef, "matches"), "proof_match"));

  // Players
  players.forEach((p, idx) => {
    const pid = p?.id;
    assertId("player", pid, { idx, p });

    batch.set(doc(collection(tRef, "players"), pid), {
      id: pid,
      slotId: p.slotId ?? null,
      name: p.name ?? "",
      teamId: p.teamId ?? "",
      courseHcp: typeof p.courseHcp === "number" ? p.courseHcp : Number(p.courseHcp || 0),
      updatedAt: Date.now(),
    });
  });

  // Days + matches
  days.forEach((d, dayIdx) => {
    const dayId = String(d?.day);
    assertId("day", dayId, { dayIdx, d });

    batch.set(doc(collection(tRef, "days"), dayId), {
      day: d.day,
      date: d.date ?? "",
      title: d.title ?? "",
      courseName: d.courseName ?? "",
      updatedAt: Date.now(),
    });

    const matches = Array.isArray(d.matches) ? d.matches : [];
    matches.forEach((m, matchIdx) => {
      const mid = m?.id;
      assertId("match", mid, { day: d.day, matchIdx, m });

      batch.set(doc(collection(tRef, "matches"), mid), {
        ...m,
        day: d.day,
        updatedAt: Date.now(),
      });
    });
  });

  await batch.commit();

  // Verification readback (just to confirm at least 1 doc exists)
  const playersSnap = await getDocs(query(collection(tRef, "players"), limit(1)));
  const daysSnap = await getDocs(query(collection(tRef, "days"), limit(1)));
  const matchesSnap = await getDocs(query(collection(tRef, "matches"), limit(1)));

  return {
    wrote: { players: players.length, days: days.length, matches: matchCount },
    existsCheck: {
      playersSeen: playersSnap.size,
      daysSeen: daysSnap.size,
      matchesSeen: matchesSnap.size,
    },
  };
}
