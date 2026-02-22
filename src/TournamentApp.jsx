// src/TournamentApp.jsx
import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { collection, doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";

import {
  Trophy,
  Users,
  Flag,
  ChevronLeft,
  Tv,
  Shield,
  Lock,
  Unlock,
  Pencil,
  Crown,
  UserCheck,
} from "lucide-react";

// =========================================================
// Frellis Cup 2026 — Firebase-backed tournament app
// - Public viewing allowed (no login required)
// - Players must sign in to claim + enter scores
// - Owner/Admin can edit roster, schedule, and admin roles
// =========================================================

// -----------------------
// Tournament constants
// -----------------------
const TOURNAMENT_TITLE = "FRELLIS CUP 2026";
const TOURNAMENT_SUBTITLE = "Live Scoring — Player Claim + Real-Time Standings";

// Dates (America/New_York)
const DAY_DATES = {
  1: "March 5, 2026",
  2: "March 6, 2026",
  3: "March 7, 2026",
};

// -----------------------
// Live Weather (Phoenix) — Open-Meteo (no API key)
// -----------------------
const PHX_LAT = 33.4484;
const PHX_LON = -112.074;

function weatherCodeToText(code) {
  // Open-Meteo weather codes
  // https://open-meteo.com/en/docs (Weather interpretation codes) :contentReference[oaicite:2]{index=2}
  const c = Number(code);
  if (!Number.isFinite(c)) return "—";

  if (c === 0) return "Clear";
  if (c === 1) return "Mostly Clear";
  if (c === 2) return "Partly Cloudy";
  if (c === 3) return "Overcast";

  if (c === 45 || c === 48) return "Fog";

  if (c === 51 || c === 53 || c === 55) return "Drizzle";
  if (c === 56 || c === 57) return "Freezing Drizzle";

  if (c === 61 || c === 63 || c === 65) return "Rain";
  if (c === 66 || c === 67) return "Freezing Rain";

  if (c === 71 || c === 73 || c === 75) return "Snow";
  if (c === 77) return "Snow Grains";

  if (c === 80 || c === 81 || c === 82) return "Rain Showers";
  if (c === 85 || c === 86) return "Snow Showers";

  if (c === 95) return "Thunderstorm";
  if (c === 96 || c === 99) return "Thunderstorm (Hail)";

  return "—";
}

function usePhoenixWeather() {
  const [wx, setWx] = React.useState({
    loading: true,
    tempF: null,
    condition: "—",
    updatedNote: "Loading live Phoenix weather…",
    error: null,
  });

  React.useEffect(() => {
    let cancelled = false;

    async function fetchWx() {
      try {
        // Open-Meteo "current" variables. No key required. :contentReference[oaicite:3]{index=3}
        const url =
          `https://api.open-meteo.com/v1/forecast` +
          `?latitude=${PHX_LAT}` +
          `&longitude=${PHX_LON}` +
          `&current=temperature_2m,weather_code` +
          `&temperature_unit=fahrenheit` +
          `&timezone=America%2FNew_York`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`Weather HTTP ${res.status}`);
        const data = await res.json();

        const temp = data?.current?.temperature_2m ?? null;
        const code = data?.current?.weather_code ?? null;

        const updatedTime = data?.current?.time
          ? new Date(data.current.time)
          : new Date();

        if (!cancelled) {
          setWx({
            loading: false,
            tempF: Number.isFinite(Number(temp)) ? Math.round(Number(temp)) : null,
            condition: weatherCodeToText(code),
            updatedNote: `Live Phoenix Conditions • Updated ${updatedTime.toLocaleString()}`,
            error: null,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setWx((prev) => ({
            ...prev,
            loading: false,
            error: e?.message || String(e),
            updatedNote: "Live Phoenix Conditions (unavailable)",
          }));
        }
      }
    }

    fetchWx();
    const id = setInterval(fetchWx, 10 * 60 * 1000); // refresh every 10 min

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return wx;
}

const TEAM = {
  JC: "Jumping Chollas",
  SG: "Saguaros",
};

const TEAM_ABBR = {
  JC: "JCGC",
  SG: "SGC",
};

const TEAM_COLOR = {
  JC: "bg-red-500/20 text-red-100 border-red-400/30",
  SG: "bg-yellow-400/20 text-yellow-100 border-yellow-300/30",
};

// Temporary weather snapshot (pre-live API)
const PHX_WEATHER_SNAPSHOT = {
  condition: "Sunny",
  tempF: 74,
  updatedNote: "Current Conditions In Phoenix",
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// -----------------------
// Scoring helpers
// -----------------------
function stablefordFromDiff(diff) {
  if (diff <= -3) return 10;
  if (diff === -2) return 6;
  if (diff === -1) return 3;
  if (diff === 0) return 1;
  if (diff === 1) return -1;
  return -2;
}

function strokesReceivedOnHole(courseHcp, holeHcpRank) {
  const full = Math.floor(courseHcp / 18);
  const rem = courseHcp % 18;
  const extra = holeHcpRank <= rem ? 1 : 0;
  return full + extra;
}

function netScore(gross, courseHcp, holeHcpRank) {
  if (gross == null) return null;
  const sr = strokesReceivedOnHole(courseHcp, holeHcpRank);
  return gross - sr;
}

function matchStatusFromHoles(holes, sideAId, sideBId) {
  let a = 0;
  let b = 0;
  let played = 0;

  for (const h of holes) {
    if (!h.played) continue;
    played += 1;
    if (h.winnerSideId === sideAId) a += 1;
    else if (h.winnerSideId === sideBId) b += 1;
  }

  const remaining = 18 - played;
  const diff = a - b;
  const abs = Math.abs(diff);
  const leader = diff > 0 ? "A" : diff < 0 ? "B" : "AS";

  if (abs > remaining && played > 0) {
    const up = abs;
    const toPlay = remaining;
    return {
      aHoles: a,
      bHoles: b,
      played,
      isFinal: true,
      text: leader === "AS" ? "Final (Tied)" : `Final ${up}&${toPlay}`,
      leaderSideId: diff > 0 ? sideAId : sideBId,
      isTied: false,
    };
  }

  if (played === 0) {
    return {
      aHoles: 0,
      bHoles: 0,
      played: 0,
      isFinal: false,
      text: "Not Started",
      leaderSideId: null,
      isTied: true,
    };
  }

  if (played === 18) {
    if (diff === 0) {
      return {
        aHoles: a,
        bHoles: b,
        played,
        isFinal: true,
        text: "Final (Tied)",
        leaderSideId: null,
        isTied: true,
      };
    }
    return {
      aHoles: a,
      bHoles: b,
      played,
      isFinal: true,
      text: `Final ${abs} Up`,
      leaderSideId: diff > 0 ? sideAId : sideBId,
      isTied: false,
    };
  }

  if (diff === 0) {
    return {
      aHoles: a,
      bHoles: b,
      played,
      isFinal: false,
      text: `AS Thru ${played}`,
      leaderSideId: null,
      isTied: true,
    };
  }

  return {
    aHoles: a,
    bHoles: b,
    played,
    isFinal: false,
    text: `${abs} Up Thru ${played}`,
    leaderSideId: diff > 0 ? sideAId : sideBId,
    isTied: false,
  };
}

function stablefordTotalsStatusFromHoles(matchHoles, sideAId, sideBId) {
  let aTotal = 0;
  let bTotal = 0;
  let played = 0;

  for (const h of matchHoles) {
    if (!h.played) continue;
    if (h.details?.type !== "scramble") continue;

    const aPts = h.details?.aPts;
    const bPts = h.details?.bPts;
    if (aPts == null || bPts == null) continue;

    played += 1;
    aTotal += aPts;
    bTotal += bPts;
  }

  if (played === 0) {
    return {
      played: 0,
      isFinal: false,
      text: "—",
      leaderSideId: null,
      isTied: true,
      aTotalPts: 0,
      bTotalPts: 0,
    };
  }

  const diff = aTotal - bTotal;
  const leaderSideId = diff > 0 ? sideAId : diff < 0 ? sideBId : null;
  const isTied = diff === 0;

  return {
    played,
    isFinal: played === 18,
    text: `${aTotal}–${bTotal}`, // 👈 show only running totals
    leaderSideId,
    isTied,
    aTotalPts: aTotal,
    bTotalPts: bTotal,
  };
}

function pointsForFinalMatch(status, sideA, sideB) {
  if (!status.isFinal) return { [sideA.teamId]: 0, [sideB.teamId]: 0 };

  if (status.isTied) return { [sideA.teamId]: 0.5, [sideB.teamId]: 0.5 };

  const winnerSideId = status.leaderSideId;
  const winnerTeam = winnerSideId === sideA.id ? sideA.teamId : sideB.teamId;
  const loserTeam = winnerTeam === sideA.teamId ? sideB.teamId : sideA.teamId;

  return { [winnerTeam]: 1, [loserTeam]: 0 };
}

// -----------------------
// Courses
// -----------------------
function holesFromParAndHcp(parArr, hcpArr) {
  return parArr.map((par, i) => ({ hole: i + 1, par, hcpRank: hcpArr[i] }));
}

const COURSES = {
  1: {
    name: "Wildfire Golf Club (Fazio Course)",
    city: "Phoenix, Arizona",
    holes: holesFromParAndHcp(
      [4, 4, 5, 4, 3, 4, 4, 3, 5, 4, 5, 4, 3, 5, 3, 4, 4, 4],
      [12, 8, 2, 16, 18, 10, 4, 14, 6, 11, 5, 9, 17, 1, 13, 15, 3, 7]
    ),
  },
  2: {
    name: "Lookout Mountain Golf Club",
    city: "Phoenix, Arizona",
    holes: holesFromParAndHcp(
      [4, 5, 3, 4, 5, 3, 5, 4, 3, 4, 3, 4, 4, 4, 5, 3, 4, 5],
      [11, 9, 15, 3, 7, 13, 1, 5, 17, 4, 12, 2, 18, 8, 16, 6, 14, 10]
    ),
  },
  3: {
    name: "Papago Golf Club",
    city: "Phoenix, Arizona",
    holes: holesFromParAndHcp(
      [5, 4, 4, 3, 4, 4, 4, 3, 5, 5, 3, 4, 4, 4, 5, 4, 3, 4],
      [15, 13, 1, 9, 7, 5, 3, 11, 17, 18, 14, 16, 6, 10, 12, 2, 8, 4]
    ),
  },
};

// -----------------------
// Local fallback tournament (used only if Firestore empty)
// -----------------------
const SAMPLE_ROSTER_SLOTS = [
  { id: "slot-jc-1", teamId: "JC", name: "Matthew Ellis (C)", courseHcp: 13 },
  { id: "slot-jc-2", teamId: "JC", name: "Jason Franklin", courseHcp: 8 },
  { id: "slot-jc-3", teamId: "JC", name: "Ben Ellis", courseHcp: 12 },
  { id: "slot-jc-4", teamId: "JC", name: "Anthony Heinrichs", courseHcp: 4 },
  { id: "slot-jc-5", teamId: "JC", name: "Teddy Hill", courseHcp: 14 },
  { id: "slot-jc-6", teamId: "JC", name: "Joe Barrett", courseHcp: 17 },
  { id: "slot-jc-7", teamId: "JC", name: "Bryer Benham", courseHcp: 20 },
  { id: "slot-jc-8", teamId: "JC", name: "Ted Robson", courseHcp: 22 },
  { id: "slot-jc-9", teamId: "JC", name: "Ben Fabrizi", courseHcp: 22 },
  { id: "slot-jc-10", teamId: "JC", name: "Sah Shah", courseHcp: 28 },
  { id: "slot-sg-1", teamId: "SG", name: "Brett Sharpe (C)", courseHcp: 23 },
  { id: "slot-sg-2", teamId: "SG", name: "Owen Guest", courseHcp: 3 },
  { id: "slot-sg-3", teamId: "SG", name: "Chris Brezler", courseHcp: 6 },
  { id: "slot-sg-4", teamId: "SG", name: "Gavin Robson", courseHcp: 12 },
  { id: "slot-sg-5", teamId: "SG", name: "Jeff Trammell", courseHcp: 14 },
  { id: "slot-sg-6", teamId: "SG", name: "Matt Paulina", courseHcp: 15 },
  { id: "slot-sg-7", teamId: "SG", name: "Brian Ellis", courseHcp: 20 },
  { id: "slot-sg-8", teamId: "SG", name: "Shawn Ellis", courseHcp: 21 },
  { id: "slot-sg-9", teamId: "SG", name: "Pierce Robson", courseHcp: 28 },
  { id: "slot-sg-10", teamId: "SG", name: "Jack Hankins", courseHcp: 17 },
];

export function makeInitialTournament() {
  const players = SAMPLE_ROSTER_SLOTS.map((s, idx) => ({
    id: `p${idx + 1}`,
    slotId: s.id,
    name: s.name,
    teamId: s.teamId,
    courseHcp: s.courseHcp,
  }));

  const day1 = Array.from({ length: 5 }, (_, i) => {
    const matchNo = i + 1;
    const aPlayers = [players[i * 2], players[i * 2 + 1]].map((p) => p.id);
    const bPlayers = [players[10 + i * 2], players[10 + i * 2 + 1]].map((p) => p.id);
    return {
      id: `d1m${matchNo}`,
      day: 1,
      matchNo,
      format: "FOURBALL_NET",
      sideA: { id: `d1m${matchNo}-A`, teamId: "JC", playerIds: aPlayers },
      sideB: { id: `d1m${matchNo}-B`, teamId: "SG", playerIds: bPlayers },
      locked: false,
      finalized: false,
      fourballGrossByPlayer: {},
    };
  });

  const day2 = Array.from({ length: 5 }, (_, i) => {
    const matchNo = i + 1;
    const aPlayers = [players[i * 2], players[i * 2 + 1]].map((p) => p.id);
    const bPlayers = [players[10 + i * 2], players[10 + i * 2 + 1]].map((p) => p.id);
    return {
      id: `d2m${matchNo}`,
      day: 2,
      matchNo,
      format: "SCRAMBLE_STABLEFORD",
      sideA: { id: `d2m${matchNo}-A`, teamId: "JC", playerIds: aPlayers },
      sideB: { id: `d2m${matchNo}-B`, teamId: "SG", playerIds: bPlayers },
      locked: false,
      finalized: false,
      scrambleGrossBySide: {},
    };
  });

  const day3 = Array.from({ length: 10 }, (_, i) => {
    const matchNo = i + 1;
    const aPlayer = players[i].id;
    const bPlayer = players[10 + i].id;
    return {
      id: `d3m${matchNo}`,
      day: 3,
      matchNo,
      format: "SINGLES_NET",
      sideA: { id: `d3m${matchNo}-A`, teamId: "JC", playerIds: [aPlayer] },
      sideB: { id: `d3m${matchNo}-B`, teamId: "SG", playerIds: [bPlayer] },
      locked: false,
      finalized: false,
      singlesGrossByPlayer: {},
    };
  });

  return {
    name: TOURNAMENT_TITLE,
    subtitle: TOURNAMENT_SUBTITLE,
    established: 2023,
    courses: COURSES,
    players,
    ownerUserId: "OWNER_UID_HERE",
    adminUserIds: ["OWNER_UID_HERE"],
    claims: {},
    days: [
      {
        day: 1,
        date: DAY_DATES[1],
        title: "Day 1 — 2v2 Fourball (Net Match Play)",
        courseName: COURSES[1].name,
        matches: day1,
      },
      {
        day: 2,
        date: DAY_DATES[2],
        title: "Day 2 — 2v2 Scramble (Stableford Match Play)",
        courseName: COURSES[2].name,
        matches: day2,
      },
      {
        day: 3,
        date: DAY_DATES[3],
        title: "Day 3 — Singles (Net Match Play)",
        courseName: COURSES[3].name,
        matches: day3,
      },
    ],
  };
}

// -----------------------
// Derived scoring
// -----------------------
function computeMatchHoles(match, holes, playersById) {
  return holes.map((h) => {
    const hole = h.hole;

    if (match.format === "FOURBALL_NET") {
      const aP = match.sideA.playerIds;
      const bP = match.sideB.playerIds;

      const getGross = (pid) => match.fourballGrossByPlayer?.[pid]?.[hole] ?? null;

      const aNets = aP
        .map((pid) => {
          const gross = getGross(pid);
          const p = playersById[pid];
          const net = p ? netScore(gross, p.courseHcp, h.hcpRank) : null;
          return { pid, gross, net };
        })
        .filter((x) => x.gross != null && x.net != null);

      const bNets = bP
        .map((pid) => {
          const gross = getGross(pid);
          const p = playersById[pid];
          const net = p ? netScore(gross, p.courseHcp, h.hcpRank) : null;
          return { pid, gross, net };
        })
        .filter((x) => x.gross != null && x.net != null);

      if (aNets.length === 0 || bNets.length === 0) {
        return {
          hole,
          played: false,
          winnerSideId: null,
          details: { type: "fourball", aBest: null, bBest: null },
        };
      }

      const aBest = aNets.reduce((best, cur) => (best == null || cur.net < best.net ? cur : best), null);
      const bBest = bNets.reduce((best, cur) => (best == null || cur.net < best.net ? cur : best), null);

      let winner = null;
      if (aBest.net < bBest.net) winner = match.sideA.id;
      else if (bBest.net < aBest.net) winner = match.sideB.id;

      return { hole, played: true, winnerSideId: winner, details: { type: "fourball", aBest, bBest } };
    }

    if (match.format === "SCRAMBLE_STABLEFORD") {
      const getSideGross = (sideId) => match.scrambleGrossBySide?.[sideId]?.[hole] ?? null;
      const aGross = getSideGross(match.sideA.id);
      const bGross = getSideGross(match.sideB.id);

      if (aGross == null || bGross == null) {
        return {
          hole,
          played: false,
          winnerSideId: null,
          details: { type: "scramble", aGross: null, bGross: null, aPts: null, bPts: null },
        };
      }

      const aPts = stablefordFromDiff(aGross - h.par);
      const bPts = stablefordFromDiff(bGross - h.par);

      let winner = null;
      if (aPts > bPts) winner = match.sideA.id;
      else if (bPts > aPts) winner = match.sideB.id;

      return { hole, played: true, winnerSideId: winner, details: { type: "scramble", aGross, bGross, aPts, bPts } };
    }

    // Singles
    const aPid = match.sideA.playerIds[0];
    const bPid = match.sideB.playerIds[0];

    const aGross = match.singlesGrossByPlayer?.[aPid]?.[hole] ?? null;
    const bGross = match.singlesGrossByPlayer?.[bPid]?.[hole] ?? null;

    if (aGross == null || bGross == null) {
      return {
        hole,
        played: false,
        winnerSideId: null,
        details: { type: "singles", aGross: null, bGross: null, aNet: null, bNet: null },
      };
    }

    const aP = playersById[aPid];
    const bP = playersById[bPid];
    const aNet = aP ? netScore(aGross, aP.courseHcp, h.hcpRank) : null;
    const bNet = bP ? netScore(bGross, bP.courseHcp, h.hcpRank) : null;

    let winner = null;
    if (aNet != null && bNet != null) {
      if (aNet < bNet) winner = match.sideA.id;
      else if (bNet < aNet) winner = match.sideB.id;
    }

    return { hole, played: true, winnerSideId: winner, details: { type: "singles", aGross, bGross, aNet, bNet } };
  });
}

function computeTournamentTotals(tournament) {
  const playersById = Object.fromEntries((tournament.players || []).map((p) => [p.id, p]));

  const daySummaries = (tournament.days || []).map((d) => {
    const holes = tournament.courses?.[d.day]?.holes || [];
    let jc = 0;
    let sg = 0;

    const matchCards = (d.matches || []).map((m) => {
      const mh = computeMatchHoles(m, holes, playersById);
      const status =
  m.format === "SCRAMBLE_STABLEFORD"
    ? stablefordTotalsStatusFromHoles(mh, m.sideA.id, m.sideB.id)
    : matchStatusFromHoles(
        mh.map((x) => ({ played: x.played, winnerSideId: x.winnerSideId })),
        m.sideA.id,
        m.sideB.id
      );
      const pts = pointsForFinalMatch(status, m.sideA, m.sideB);
      jc += pts.JC ?? 0;
      sg += pts.SG ?? 0;

      return {
        match: m,
        holes: mh,
        status,
        points: pts,
        courseName: tournament.courses?.[d.day]?.name || d.courseName,
      };
    });

    return { day: d.day, title: d.title, courseName: d.courseName, jc, sg, matchCards };
  });

  const totalJC = daySummaries.reduce((s, d) => s + d.jc, 0);
  const totalSG = daySummaries.reduce((s, d) => s + d.sg, 0);

  return { daySummaries, totalJC, totalSG };
}

// -----------------------
// UI Components
// -----------------------
function Pill({ children, tone = "neutral" }) {
  const tones = {
    neutral: "bg-white/10 text-white border-white/10",
    warn: "bg-amber-500/15 text-amber-100 border-amber-400/20",
    jcLead: "bg-red-500/20 text-red-100 border-red-400/30",
    sgLead: "bg-yellow-400/20 text-yellow-100 border-yellow-300/30",
    final: "bg-emerald-500/15 text-emerald-100 border-emerald-400/20",
  };
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs ${tones[tone] || tones.neutral}`}>
      {children}
    </span>
  );
}

function Card({ children, className = "" }) {
  return <div className={`rounded-2xl bg-white/5 border border-white/10 shadow-sm ${className}`}>{children}</div>;
}

function Button({ children, onClick, variant = "primary", className = "", disabled, type = "button" }) {
  const styles = {
    primary: "bg-white text-zinc-900 hover:bg-white/90 disabled:bg-white/40 disabled:text-zinc-900/60",
    ghost: "bg-white/0 text-white hover:bg-white/10 border border-white/10 disabled:opacity-50",
    danger: "bg-rose-500 text-white hover:bg-rose-500/90 disabled:opacity-50",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 rounded-xl text-sm font-medium transition active:scale-[0.99] ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="flex gap-2 p-1 rounded-2xl bg-white/5 border border-white/10">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            className={`flex-1 px-3 py-2 rounded-xl text-sm transition ${
              active ? "bg-white text-zinc-900" : "text-white/80 hover:bg-white/10"
            }`}
          >
            <span className="inline-flex items-center justify-center gap-2">{o.icon}{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function StatBlock({ label, value, sub, logoSrc }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
      <div className="flex items-start justify-between gap-6">
        {/* LEFT */}
        <div className="min-w-0">
          <div className="text-white/60 text-sm">{sub}</div>
          <div className="text-white text-2xl font-semibold mt-1 truncate">{label}</div>

          {logoSrc ? (
            <div className="mt-4">
              <img
                src={logoSrc}
                alt={`${label} logo`}
                className="h-10 w-28 object-contain opacity-90"
                loading="lazy"
                onError={(e) => {
                  // Hide the broken image icon completely if it fails
                  e.currentTarget.style.display = "none";
                }}
              />
            </div>
          ) : null}
        </div>

        {/* RIGHT */}
        <div className="shrink-0 text-white text-6xl font-extrabold leading-none">
          {value}
        </div>
      </div>
    </div>
  );
}

function TeamBadge({ teamId, showFull = false }) {
  const label = showFull ? TEAM[teamId] : TEAM_ABBR[teamId];
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${TEAM_COLOR[teamId]}`}>
      <Shield className="w-4 h-4" />
      <span className="text-xs font-medium">{label}</span>
    </span>
  );
}

function MatchFormatPill({ format }) {
  if (format === "FOURBALL_NET")
    return (
      <Pill>
        <Users className="w-4 h-4" />Fourball (Net)
      </Pill>
    );
  if (format === "SCRAMBLE_STABLEFORD")
    return (
      <Pill>
        <Flag className="w-4 h-4" />Scramble (Stableford)
      </Pill>
    );
  return (
    <Pill>
      <Trophy className="w-4 h-4" />Singles (Net)
    </Pill>
  );
}

function statusPillTone(status, match) {
  if (status.isFinal) return status.text.includes("Tied") ? "warn" : "final";
  if (status.isTied) return "neutral";
  const leaderTeam = status.leaderSideId === match.sideA.id ? match.sideA.teamId : match.sideB.teamId;
  return leaderTeam === "JC" ? "jcLead" : "sgLead";
}

function TournamentHeaderMark() {
  return (
    <div className="w-full flex justify-center items-center px-4 text-center">
      <div className="max-w-full">
        <div
          className="
            text-[#c8a96a]
            uppercase
            font-extrabold
            leading-tight
            tracking-[0.18em]
            text-[40px]      /* mobile */
            sm:text-[60px]   /* small screens */
            md:text-[72px]   /* desktop */
          "
        >
          The Frellis Cup
        </div>

        <div
          className="
            text-[#c8a96a]/80
            uppercase
            mt-3
            tracking-[0.22em]
            text-[12px]
            sm:text-[14px]
          "
        >
          Arizona Desert Match Play • Est. 2023
        </div>
      </div>
    </div>
  );
}

function TopBar({ title, subtitle, left, right }) {
  return (
    <div className="sticky top-0 z-30 backdrop-blur bg-zinc-950/60 border-b border-white/10">
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {left}
          <div>
            {title ? <div className="text-white text-base font-semibold">{title}</div> : null}
            {subtitle ? <div className="text-white/60 text-xs mt-0.5">{subtitle}</div> : null}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">{right}</div>
      </div>
    </div>
  );
}

function Modal({ open, onClose, title, children }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/60" onClick={onClose} />
          <motion.div
            className="absolute inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center p-0 md:p-6"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
          >
            <div className="w-full md:max-w-2xl rounded-t-3xl md:rounded-3xl bg-zinc-950 border border-white/10 shadow-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
                <div className="text-white font-semibold">{title}</div>
                <button onClick={onClose} className="text-white/70 hover:text-white">✕</button>
              </div>
              <div className="p-5">{children}</div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Sign-in modal (email/password) */
function AuthModal({ open, onClose, onSignIn, onSignUp, loading, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!open) {
      setEmail("");
      setPassword("");
    }
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Sign in">
      <div className="space-y-3">
        <input
          className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
          placeholder="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error ? (
          <div className="text-xs text-rose-200 bg-rose-500/10 border border-rose-500/20 rounded-xl p-2">
            {error}
          </div>
        ) : null}

        <div className="flex gap-2 pt-2">
          <Button className="flex-1" disabled={loading} onClick={() => onSignIn(email, password)}>
            Sign in
          </Button>
          <Button className="flex-1" variant="ghost" disabled={loading} onClick={() => onSignUp(email, password)}>
            Sign up
          </Button>
        </div>

        <div className="text-[11px] text-white/60 leading-relaxed">
          Public viewing is always available. Signing in enables player claim + score entry.
        </div>
      </div>
    </Modal>
  );
}

function NumberStepper({ value, onChange, min = 1, max = 12, disabled }) {
  const v = value ?? "";
  return (
    <div className="flex items-center gap-2">
      <button
        disabled={disabled}
        onClick={() => onChange(value == null ? min : clamp(value - 1, min, max))}
        className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 disabled:opacity-40"
      >
        −
      </button>
      <input
        disabled={disabled}
        inputMode="numeric"
        value={v}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange(null);
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onChange(clamp(Math.round(n), min, max));
        }}
        className="w-16 h-10 text-center rounded-xl bg-white/5 border border-white/10 text-white"
        placeholder="—"
      />
      <button
        disabled={disabled}
        onClick={() => onChange(value == null ? min : clamp(value + 1, min, max))}
        className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

function HoleStrip({ mc }) {
  let diff = 0;

  const cells = mc.holes.slice(0, 18).map((h, idx) => {
    if (!h.played) return { bg: "bg-white/10", txt: "", title: `Hole ${idx + 1}: Not Played` };

    if (h.winnerSideId == null) {
      const lead = diff === 0 ? "AS" : diff > 0 ? `JCGC ${diff} Up` : `SGC ${Math.abs(diff)} Up`;
      return {
        bg: "bg-white/15",
        txt: diff === 0 ? "0" : String(Math.abs(diff)),
        title: `Hole ${idx + 1}: Halved (Match ${lead})`,
      };
    }

    if (h.winnerSideId.endsWith("-A")) diff += 1;
    else diff -= 1;

    const bg = diff > 0 ? "bg-red-500/40" : diff < 0 ? "bg-yellow-400/40" : "bg-white/15";
    const txt = diff === 0 ? "0" : String(Math.abs(diff));
    const lead = diff === 0 ? "AS" : diff > 0 ? `JCGC ${diff} Up` : `SGC ${Math.abs(diff)} Up`;
    return { bg, txt, title: `Hole ${idx + 1}: ${lead}` };
  });

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex whitespace-nowrap flex-nowrap gap-1">
        {cells.map((c, idx) => (
          <div
            key={idx}
            className={`w-6 h-6 rounded-md ${c.bg} border border-white/10 flex items-center justify-center text-[11px] font-semibold`}
            title={c.title}
          >
            <span className="text-white/90">{c.txt}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// -----------------------
// Main App
// Props expected from App.jsx:
// - tournamentId: string (e.g. "frellis-cup-2026")
// - fbUser: Firebase user object or null
// -----------------------
export default function TournamentApp({ tournamentId = "frellis-cup-2026", fbUser = null, isAdminUser = false, onOpenReseed }) {
  const auth = getAuth();

  // If App.jsx passes fbUser, use it. Otherwise, listen locally.
  const [localUser, setLocalUser] = useState(null);
  const effectiveUser = fbUser ?? localUser;

  const userId = effectiveUser?.uid ?? null; // null = public viewer
  const signedInLabel = effectiveUser?.email ?? "Public Viewer";

  // auth modal state
  const [authOpen, setAuthOpen] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (fbUser) return; // parent controls auth
    return onAuthStateChanged(auth, (u) => setLocalUser(u));
  }, [auth, fbUser]);

  async function handleSignIn(email, password) {
    try {
      setAuthLoading(true);
      setAuthError("");
      await signInWithEmailAndPassword(auth, email, password);
      setAuthOpen(false);
    } catch (e) {
      setAuthError(e?.message || "Sign in failed.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSignUp(email, password) {
    try {
      setAuthLoading(true);
      setAuthError("");
      await createUserWithEmailAndPassword(auth, email, password);
      setAuthOpen(false);
    } catch (e) {
      setAuthError(e?.message || "Sign up failed.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSignOut() {
    await signOut(auth);
  }

  // Store Firestore pieces separately then assemble
  const [base, setBase] = useState(null);
  const [players, setPlayers] = useState([]);
  const [days, setDays] = useState([]);
  const [matches, setMatches] = useState([]);

  const [route, setRoute] = useState({ name: "home" });
  const [activeDay, setActiveDay] = useState(1);

  // Live subscriptions
  useEffect(() => {
    const tRef = doc(db, "tournaments", tournamentId);

    const unsubBase = onSnapshot(tRef, (snap) => {
      if (!snap.exists()) {
        setBase(null);
        return;
      }
      setBase({ id: snap.id, ...snap.data() });
    });

    const unsubPlayers = onSnapshot(collection(tRef, "players"), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      setPlayers(rows);
    });

    const unsubDays = onSnapshot(collection(tRef, "days"), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => Number(a.day) - Number(b.day));
      setDays(rows);
    });

    const unsubMatches = onSnapshot(collection(tRef, "matches"), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => Number(a.day) - Number(b.day) || Number(a.matchNo) - Number(b.matchNo));
      setMatches(rows);
    });

    return () => {
      unsubBase();
      unsubPlayers();
      unsubDays();
      unsubMatches();
    };
  }, [tournamentId]);

  // Assemble tournament object
  const tournament = useMemo(() => {
    const fallback = makeInitialTournament();

    const effectiveBase = base || {
      name: fallback.name,
      subtitle: fallback.subtitle,
      established: fallback.established,
      ownerUserId: null,
      adminUserIds: [],
      claims: {},
      courses: fallback.courses,
    };

    const dayList = (days.length ? days : fallback.days).map((d) => {
      const dayNum = Number(d.day ?? d.id);
      const dayMatches = matches
        .filter((m) => Number(m.day) === dayNum)
        .sort((a, b) => Number(a.matchNo) - Number(b.matchNo));

      return {
        day: dayNum,
        date: d.date ?? DAY_DATES[dayNum] ?? "",
        title: d.title ?? fallback.days.find((x) => x.day === dayNum)?.title ?? `Day ${dayNum}`,
        courseName: d.courseName ?? effectiveBase.courses?.[dayNum]?.name ?? "",
        matches: dayMatches,
      };
    });

    return {
      name: effectiveBase.name ?? fallback.name,
      subtitle: effectiveBase.subtitle ?? fallback.subtitle,
      established: effectiveBase.established ?? fallback.established,
      courses: effectiveBase.courses ?? fallback.courses,
      ownerUserId: effectiveBase.ownerUserId ?? null,
      adminUserIds: Array.isArray(effectiveBase.adminUserIds) ? effectiveBase.adminUserIds : [],
      claims: effectiveBase.claims ?? {},
      players: players.length ? players : fallback.players,
      days: dayList,
    };
  }, [base, players, days, matches]);

  const claimedPlayerId = userId ? tournament.claims?.[userId] || null : null;

  const isAdmin =
    !!userId && (userId === tournament.ownerUserId || (tournament.adminUserIds || []).includes(userId));

  const playersById = useMemo(
    () => Object.fromEntries((tournament.players || []).map((p) => [p.id, p])),
    [tournament.players]
  );

  const totals = useMemo(() => computeTournamentTotals(tournament), [tournament]);

  // -----------------------
  // Firestore write helpers
  // -----------------------
  async function writeMatch(matchId, patch) {
    const tRef = doc(db, "tournaments", tournamentId);
    const mRef = doc(tRef, "matches", matchId);
    await updateDoc(mRef, { ...patch, updatedAt: Date.now() });
  }

  async function writePlayer(playerId, patch) {
    const tRef = doc(db, "tournaments", tournamentId);
    const pRef = doc(tRef, "players", playerId);
    await updateDoc(pRef, { ...patch, updatedAt: Date.now() });
  }

  async function addPlayer() {
    const tRef = doc(db, "tournaments", tournamentId);

    // Find next p#
    const nums = (tournament.players || [])
      .map((p) => {
        const m = String(p.id || "").match(/^p(\d+)$/);
        return m ? Number(m[1]) : null;
      })
      .filter((x) => Number.isFinite(x));
    const nextNum = (nums.length ? Math.max(...nums) : 0) + 1;
    const nextId = `p${nextNum}`;

    const newPlayer = {
      id: nextId,
      slotId: `slot-${nextId}`,
      name: "New Player",
      teamId: "JC",
      courseHcp: 10,
      updatedAt: Date.now(),
    };

    await setDoc(doc(collection(tRef, "players"), nextId), newPlayer, { merge: true });
  }

  async function setClaimForUser(uid, playerId) {
    if (!uid) return;
    const tRef = doc(db, "tournaments", tournamentId);

    // Enforce uniqueness of claims (one player per uid, and one uid per player)
    const nextClaims = { ...(tournament.claims || {}) };
    Object.keys(nextClaims).forEach((k) => {
      if (nextClaims[k] === playerId) delete nextClaims[k];
    });
    nextClaims[uid] = playerId;

    await updateDoc(tRef, { claims: nextClaims, updatedAt: Date.now() });
  }

  async function clearMyClaim(uid) {
    if (!uid) return;
    const tRef = doc(db, "tournaments", tournamentId);
    const nextClaims = { ...(tournament.claims || {}) };
    delete nextClaims[uid];
    await updateDoc(tRef, { claims: nextClaims, updatedAt: Date.now() });
  }

  async function addAdminUid(uidToAdd) {
    const cleaned = (uidToAdd || "").trim();
    if (!cleaned) return;
    const tRef = doc(db, "tournaments", tournamentId);
    const set = new Set(tournament.adminUserIds || []);
    if (tournament.ownerUserId) set.add(tournament.ownerUserId);
    set.add(cleaned);
    await updateDoc(tRef, { adminUserIds: Array.from(set), updatedAt: Date.now() });
  }

  async function removeAdminUid(uidToRemove) {
    const tRef = doc(db, "tournaments", tournamentId);
    const set = new Set(tournament.adminUserIds || []);
    set.delete(uidToRemove);
    if (tournament.ownerUserId) set.add(tournament.ownerUserId);
    await updateDoc(tRef, { adminUserIds: Array.from(set), updatedAt: Date.now() });
  }

  // -----------------------
  // Pages routing
  // -----------------------
  const pageContent = (() => {
    if (route.name === "home") {
      return (
        <HomePage
  tournament={tournament}
  totals={totals}
  activeDay={activeDay}
  setActiveDay={setActiveDay}
  signedInLabel={signedInLabel}
  userId={userId}
  claimedPlayerId={claimedPlayerId}
  playersById={playersById}
  isAdmin={isAdmin}
  isAdminUser={isAdminUser}
  onOpenReseed={onOpenReseed}
  onOpenAdminPage={() => setRoute({ name: "admin" })}
  onOpenMatches={() => setRoute({ name: "matches" })}
  onOpenMatch={(matchId) => setRoute({ name: "match", matchId })}
  onOpenBroadcast={() => setRoute({ name: "broadcast" })}
  onOpenClaim={() => setRoute({ name: "claim" })}
/>
      );
    }

    if (route.name === "claim") {
      return (
        <ClaimPage
          tournament={tournament}
          playersById={playersById}
          fbUid={userId}
          signedInLabel={signedInLabel}
          claimedPlayerId={claimedPlayerId}
          setClaimForUser={setClaimForUser}
          clearMyClaim={clearMyClaim}
          onBack={() => setRoute({ name: "home" })}
        />
      );
    }

    if (route.name === "matches") {
      return (
        <MatchesPage
          tournament={tournament}
          totals={totals}
          activeDay={activeDay}
          setActiveDay={setActiveDay}
          playersById={playersById}
          onBack={() => setRoute({ name: "home" })}
          onOpenMatch={(matchId) => setRoute({ name: "match", matchId })}
        />
      );
    }

    if (route.name === "match") {
      const { matchId } = route;
      const day = tournament.days.find((d) => d.matches.some((m) => m.id === matchId));
      const match = day?.matches.find((m) => m.id === matchId);
      if (!match || !day) return null;

      return (
        <MatchPage
          tournament={tournament}
          totals={totals}
          match={match}
          day={day}
          playersById={playersById}
          claimedPlayerId={claimedPlayerId}
          isAdmin={isAdmin}
          onBack={() => setRoute({ name: "matches" })}
          writeMatch={writeMatch}
        />
      );
    }

    if (route.name === "broadcast") {
      return (
        <BroadcastPage
          tournament={tournament}
          totals={totals}
          playersById={playersById}
          onExit={() => setRoute({ name: "home" })}
          onOpenMatch={(matchId) => setRoute({ name: "match", matchId })}
        />
      );
    }

    if (route.name === "admin") {
      return (
        <AdminPage
          tournament={tournament}
          userId={userId}
          isAdmin={isAdmin}
          onBack={() => setRoute({ name: "home" })}
          writePlayer={writePlayer}
          writeMatch={writeMatch}
          addAdminUid={addAdminUid}
          removeAdminUid={removeAdminUid}
          addPlayer={addPlayer}
        />
      );
    }

    return null;
  })();

  return (
    <div className="min-h-screen bg-zinc-950 text-white overflow-x-hidden flex flex-col">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-orange-400/15 blur-3xl" />
        <div className="absolute top-24 right-0 w-[34rem] h-[34rem] rounded-full bg-fuchsia-500/10 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[40rem] h-[22rem] rounded-full bg-amber-300/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 w-[44rem] h-[24rem] rounded-full bg-red-500/10 blur-3xl" />
      </div>

      <style>{`
        html, body, #root {
          width: 100%;
          max-width: 100%;
          overflow-x: hidden;
        }

        * { box-sizing: border-box; }

        body { position: relative; }
      `}</style>

      <div className="relative flex-1">{pageContent}</div>

      {/* Admin tools footer (admins only) */}
      {isAdmin ? (
        <div className="sticky bottom-0 z-30 backdrop-blur bg-zinc-950/70 border-t border-white/10">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setRoute({ name: "admin" })}>
              <span className="inline-flex items-center gap-2">
                <Crown className="w-4 h-4" />
                Admin Tools
              </span>
            </Button>
          </div>
        </div>
      ) : null}

      {/* Sign-in modal */}
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSignIn={handleSignIn}
        onSignUp={handleSignUp}
        loading={authLoading}
        error={authError}
      />
    </div>
  );
}

// -----------------------
// Pages
// -----------------------
function HomePage({
  tournament,
  totals,
  activeDay,
  setActiveDay,
  signedInLabel,
  userId,
  claimedPlayerId,
  playersById,
  isAdmin,
  isAdminUser,
  onOpenReseed,
  onOpenAdminPage,
  onOpenMatches,
  onOpenMatch,
  onOpenBroadcast,
  onOpenClaim,
}) {
  const leader =
    totals.totalJC === totals.totalSG ? "Tied" : totals.totalJC > totals.totalSG ? TEAM_ABBR.JC : TEAM_ABBR.SG;

  const me = claimedPlayerId ? playersById[claimedPlayerId] : null;
  const daySummary = totals.daySummaries.find((d) => d.day === activeDay);

  const myMatch = me
    ? daySummary?.matchCards
        .map((c) => c.match)
        .find((m) => m.sideA.playerIds.includes(me.id) || m.sideB.playerIds.includes(me.id))
    : null;

  return (
    <>
      <TopBar
        title={""}
        subtitle={""}
        left={<TournamentHeaderMark />}
        right={
          <>
            <Button variant="ghost" onClick={onOpenBroadcast}>
              <span className="inline-flex items-center gap-2">
                <Tv className="w-4 h-4" />
                <span className="hidden sm:inline">Broadcast</span>
              </span>
            </Button>

            {isAdmin ? (
              <Button variant="ghost" onClick={onOpenAdminPage}>
                <span className="inline-flex items-center gap-2">
                  <Crown className="w-4 h-4" />
                  <span className="hidden sm:inline">Admin</span>
                </span>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

         <img
  src="/jc-logo.png?v=999"
  alt="jc test"
  style={{ height: 40, width: 120, objectFit: "contain", border: "1px solid red" }}
/> 
          
          <StatBlock
  label={TEAM.JC}
  value={totals.totalJC.toFixed(1)}
  sub="Overall"
  logoSrc="/jc-logo.png?v=2"
/>

<StatBlock
  label={TEAM.SG}
  value={totals.totalSG.toFixed(1)}
  sub="Overall"
  logoSrc="/sg-logo.png?v=2"
/>
          <StatBlock label="Current Lead" value={leader} sub="Updates Live As Holes Are Entered" />
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-white font-semibold">Your Card</div>
                <div className="text-white/60 text-xs mt-1">
                  Viewing As <b>{signedInLabel}</b>
                </div>
              </div>

              {me ? (
                <Pill tone="final">
                  <UserCheck className="w-4 h-4" />
                  {me.name}
                </Pill>
              ) : (
                <Pill tone={userId ? "warn" : "neutral"}>
                  {userId ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                  {userId ? "Unclaimed" : "Public"}
                </Pill>
              )}
            </div>

            <div className="mt-4 p-4 rounded-2xl bg-white/5 border border-white/10">
              <div className="text-white/70 text-xs">Today</div>
              <div className="text-white text-sm font-medium mt-1">
                Day {activeDay} • {DAY_DATES[activeDay]}
              </div>
              <div className="text-white/70 text-xs mt-1">
                {tournament.courses?.[activeDay]?.name} • {tournament.courses?.[activeDay]?.city}
              </div>
              <div className="mt-3 text-white/80 text-sm">
                <span className="text-white/60">Weather:</span> {PHX_WEATHER_SNAPSHOT.condition} •{" "}
                {PHX_WEATHER_SNAPSHOT.tempF}°F
              </div>
              <div className="text-white/50 text-[11px] mt-1">{PHX_WEATHER_SNAPSHOT.updatedNote}</div>
            </div>

            <div className="mt-4">
              {userId ? (
                me ? (
                  <>
                    <div className="text-white/70 text-sm">
                      {me.name} • CH {me.courseHcp}
                    </div>
                    <div className="mt-3 text-white/60 text-xs">Profile claimed. Score entry enabled for your match.</div>
                  </>
                ) : (
                  <>
                    <div className="text-white/70 text-sm">Claim your profile to enable score entry.</div>
                    <div className="mt-3">
                      <Button onClick={onOpenClaim} className="w-full">
                        Claim Your Profile
                      </Button>
                    </div>
                  </>
                )
              ) : (
                <div className="text-white/60 text-xs">
                  Public view is enabled. Sign in to claim a player + enter scores.
                </div>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-white font-semibold">Enter Scores</div>
                <div className="text-white/60 text-xs mt-1">Jump straight into your match (or browse all matches).</div>
              </div>
              <Pill>
                <Pencil className="w-4 h-4" />
                Score Entry
              </Pill>
            </div>

            {!userId ? (
              <div className="mt-4 p-4 rounded-2xl bg-white/5 border border-white/10">
                <div className="text-white/70 text-sm">Public Viewer Mode</div>
                <div className="text-white/60 text-xs mt-1">Sign in to claim your identity and enter scores.</div>
                <div className="mt-3">
                  <Button variant="ghost" onClick={onOpenMatches} className="w-full">
                    Browse Matches
                  </Button>
                </div>
              </div>
            ) : !me ? (
              <div className="mt-4 p-4 rounded-2xl bg-white/5 border border-white/10">
                <div className="text-white/70 text-sm">No claimed player yet.</div>
                <div className="text-white/60 text-xs mt-1">Claim first, then you’ll get a one-tap link to your match.</div>
                <div className="mt-3 flex gap-2">
                  <Button onClick={onOpenClaim} className="flex-1">
                    Claim
                  </Button>
                  <Button variant="ghost" onClick={onOpenMatches} className="flex-1">
                    Browse Matches
                  </Button>
                </div>
              </div>
            ) : !myMatch ? (
              <div className="mt-4 p-4 rounded-2xl bg-white/5 border border-white/10">
                <div className="text-white/70 text-sm">No match found for you on Day {activeDay}.</div>
                <div className="text-white/60 text-xs mt-1">An admin can adjust matches on the Admin page.</div>
                <div className="mt-3">
                  <Button variant="ghost" onClick={onOpenMatches} className="w-full">
                    Browse All Matches
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 p-4 rounded-2xl bg-white/5 border border-white/10">
                <div className="text-white/70 text-xs">Your Match Today</div>
                <div className="text-white font-semibold mt-1">Match {myMatch.matchNo}</div>
                <div className="text-white/60 text-xs mt-1">{daySummary?.title}</div>
                <div className="mt-3 flex gap-2">
                  <Button onClick={() => onOpenMatch(myMatch.id)} className="flex-1">
                    Open Score Entry
                  </Button>
                  <Button variant="ghost" onClick={onOpenMatches} className="flex-1">
                    All Matches
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-4">
              <div className="text-white/70 text-xs mb-2">Quick Switch Day</div>
              <Segmented
                value={activeDay}
                onChange={setActiveDay}
                options={(tournament.days || []).map((d) => ({
                  value: d.day,
                  label: `Day ${d.day}`,
                  icon: null,
                }))}
              />
            </div>
          </Card>
        </div>

        <div className="mt-6">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-white font-semibold">Day {activeDay} Snapshot</div>
                <div className="text-white/60 text-xs mt-1">Points shown only for FINAL matches (ties split 0.5/0.5).</div>
              </div>
              <Pill>
                <Trophy className="w-4 h-4" />
                {(daySummary?.jc ?? 0).toFixed(1)} – {(daySummary?.sg ?? 0).toFixed(1)}
              </Pill>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {(daySummary?.matchCards || []).map((mc) => (
                <div
                  key={mc.match.id}
                  className="p-4 rounded-2xl bg-white/5 border border-white/10 cursor-pointer hover:bg-white/[0.07] transition"
                  onClick={() => onOpenMatch(mc.match.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-white/70 text-xs">Match {mc.match.matchNo}</div>
                    <Pill tone={statusPillTone(mc.status, mc.match)}>{mc.status.text}</Pill>
                  </div>
                  <div className="mt-3">
                    <HoleStrip mc={mc} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Bottom admin actions: Admin Tools + Reseed (visible to admins) */}
        {isAdminUser ? (
          <div className="mt-8">
            <Card className="p-4">
              <div className="grid grid-cols-2 gap-3">
                <Button variant="ghost" onClick={onOpenAdminPage} className="w-full">
                  Admin Tools
                </Button>

                <Button variant="danger" onClick={onOpenReseed} className="w-full">
                  Reseed Firestore
                </Button>
              </div>

              <div className="text-white/50 text-[11px] mt-3">
                Reseed overwrites players/days/matches (scores may be lost). Confirmation required.
              </div>
            </Card>
          </div>
        ) : null}

        <div className="mt-10" />
      </div>
    </>
  );
}

function ClaimPage({
  tournament,
  playersById,
  fbUid,
  signedInLabel,
  claimedPlayerId,
  setClaimForUser,
  clearMyClaim,
  onBack,
}) {
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [pendingClaim, setPendingClaim] = useState(null);
  const [confirmName, setConfirmName] = useState(false);
  const [confirmHcp, setConfirmHcp] = useState(false);

  const claimedSet = new Set(Object.values(tournament.claims || {}));
  const me = claimedPlayerId ? playersById[claimedPlayerId] : null;

  const rows = (tournament.players || [])
    .filter((p) => (teamFilter === "ALL" ? true : p.teamId === teamFilter))
    .map((p) => ({
      ...p,
      claimed: claimedSet.has(p.id),
      claimedByYou: claimedPlayerId === p.id,
    }));

  return (
    <>
      <TopBar
        title="Claim Your Identity"
        subtitle="Pick your name once — enables score entry for your match only"
        left={
          <button onClick={onBack} className="text-white/80 hover:text-white inline-flex items-center gap-2">
            <ChevronLeft className="w-5 h-5" />
            <span className="hidden sm:inline">Home</span>
          </button>
        }
        right={
          <Pill>
            <UserCheck className="w-4 h-4" />
            {me ? me.name : "Unclaimed"}
          </Pill>
        }
      />

      <div className="max-w-6xl mx-auto px-4 py-6">
        <Card className="p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="text-white font-semibold">Signed In</div>
              <div className="text-white/60 text-xs mt-1">{signedInLabel || fbUid}</div>
            </div>

            {me ? (
              <Button variant="danger" onClick={() => clearMyClaim(fbUid)}>
                Clear My Claim
              </Button>
            ) : null}
          </div>

          <div className="mt-4">
            <Segmented
              value={teamFilter}
              onChange={setTeamFilter}
              options={[
                { value: "ALL", label: "All" },
                { value: "JC", label: TEAM.JC },
                { value: "SG", label: TEAM.SG },
              ]}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {rows.map((p) => (
              <div key={p.id} className="p-4 rounded-2xl bg-white/5 border border-white/10">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-white text-sm font-medium">{p.name}</div>
                    <div className="text-white/60 text-xs">
                      {TEAM_ABBR[p.teamId]} • Handicap: {p.courseHcp}
                    </div>

                    <div className="mt-2">
                      {p.claimedByYou ? (
                        <Pill tone="final">
                          <UserCheck className="w-4 h-4" />
                          Claimed By You
                        </Pill>
                      ) : p.claimed ? (
                        <Pill tone="warn">
                          <Lock className="w-4 h-4" />
                          Already Claimed
                        </Pill>
                      ) : (
                        <Pill>
                          <Unlock className="w-4 h-4" />
                          Available
                        </Pill>
                      )}
                    </div>
                  </div>

                  <Button
                    disabled={p.claimed && !p.claimedByYou}
                    onClick={() => {
                      setPendingClaim(p);
                      setConfirmName(false);
                      setConfirmHcp(false);
                    }}
                  >
                    {p.claimedByYou ? "Re-Claim" : "Claim"}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 text-white/60 text-xs">Note: claims are enforced by Firestore (one person per identity).</div>
        </Card>

        <Modal open={!!pendingClaim} onClose={() => setPendingClaim(null)} title="Confirm Your Details">
          {pendingClaim ? (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                <div className="text-white font-semibold">You Are Claiming:</div>
                <div className="mt-2 text-white text-sm font-medium">{pendingClaim.name}</div>
                <div className="text-white/60 text-xs">
                  {TEAM[pendingClaim.teamId]} • Handicap: {pendingClaim.courseHcp}
                </div>
              </div>

              <label className="flex items-start gap-3 text-white/80 text-sm">
                <input type="checkbox" className="mt-1" checked={confirmName} onChange={(e) => setConfirmName(e.target.checked)} />
                <span>
                  I confirm my <b>Name</b> is correct.
                </span>
              </label>

              <label className="flex items-start gap-3 text-white/80 text-sm">
                <input type="checkbox" className="mt-1" checked={confirmHcp} onChange={(e) => setConfirmHcp(e.target.checked)} />
                <span>
                  I confirm my <b>Handicap</b> is correct.
                </span>
              </label>

              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setPendingClaim(null)} className="flex-1">
                  Cancel
                </Button>

                <Button
                  onClick={async () => {
                    if (!confirmName || !confirmHcp) return;
                    await setClaimForUser(fbUid, pendingClaim.id);
                    setPendingClaim(null);
                  }}
                  disabled={!confirmName || !confirmHcp}
                  className="flex-1"
                >
                  Confirm & Claim
                </Button>
              </div>

              <div className="text-white/60 text-xs">
                Once claimed, this identity links to your account ({signedInLabel || fbUid}) and controls score-entry permissions.
              </div>
            </div>
          ) : null}
        </Modal>
      </div>
    </>
  );
}

function MatchesPage({ tournament, totals, activeDay, setActiveDay, playersById, onBack, onOpenMatch }) {
  const day = totals.daySummaries.find((d) => d.day === activeDay);

  return (
    <>
      <TopBar
        title="Matches"
        subtitle={`Day ${activeDay} • ${day?.courseName || ""} • ${DAY_DATES[activeDay]}`}
        left={
          <button onClick={onBack} className="text-white/80 hover:text-white inline-flex items-center gap-2">
            <ChevronLeft className="w-5 h-5" />
            <span className="hidden sm:inline">Home</span>
          </button>
        }
        right={
          <Pill>
            <Trophy className="w-4 h-4" />
            Total {totals.totalJC.toFixed(1)}–{totals.totalSG.toFixed(1)}
          </Pill>
        }
      />

      <div className="max-w-6xl mx-auto px-4 py-6">
        <Segmented
          value={activeDay}
          onChange={setActiveDay}
          options={(tournament.days || []).map((d) => ({
            value: d.day,
            label: `Day ${d.day}`,
            icon: <span className="text-xs font-semibold">{d.day}</span>,
          }))}
        />

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {(day?.matchCards || []).map((mc) => (
            <MatchCard key={mc.match.id} mc={mc} playersById={playersById} onOpen={() => onOpenMatch(mc.match.id)} />
          ))}
        </div>
      </div>
    </>
  );
}

function MatchCard({ mc, playersById, onOpen, broadcast = false }) {
  const { match, status } = mc;

  // Ensure consistent left/right: JC on left, SG on right
  const sideForTeam = (teamId) => (match.sideA.teamId === teamId ? match.sideA : match.sideB);
  const left = sideForTeam("JC");
  const right = sideForTeam("SG");

  const leftPlayers = left.playerIds.map((id) => playersById[id]?.name ?? "—");
  const rightPlayers = right.playerIds.map((id) => playersById[id]?.name ?? "—");

  const [l1, l2] = [leftPlayers[0] ?? "—", leftPlayers[1] ?? "—"];
  const [r1, r2] = [rightPlayers[0] ?? "—", rightPlayers[1] ?? "—"];

  return (
    <Card className={`${broadcast ? "p-5" : "p-4"} cursor-pointer hover:bg-white/[0.07] transition`}>
      <div onClick={onOpen}>
        <div className="flex items-start justify-between gap-3">
          <div className="text-white/70 text-xs">Match {match.matchNo}</div>
          <div className="flex flex-col items-end gap-2">
            <MatchFormatPill format={match.format} />
            <Pill tone={statusPillTone(status, match)}>{status.text}</Pill>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
            <div className="text-red-200 font-semibold text-sm">{TEAM.JC}</div>
            <div className="mt-2 space-y-1">
              <div className="text-white text-sm font-medium">{l1}</div>
              {match.format === "SINGLES_NET" ? null : <div className="text-white text-sm font-medium">{l2}</div>}
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
            <div className="text-yellow-200 font-semibold text-sm text-right">{TEAM.SG}</div>
            <div className="mt-2 space-y-1 text-right">
              <div className="text-white text-sm font-medium">{r1}</div>
              {match.format === "SINGLES_NET" ? null : <div className="text-white text-sm font-medium">{r2}</div>}
            </div>
          </div>
        </div>

        {broadcast ? (
          <div className="mt-4 p-3 rounded-2xl bg-white/5 border border-white/10">
            <div className="text-white/60 text-xs mb-2">Holes</div>
            <HoleStrip mc={mc} />
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white/70 text-xs">
            {match.locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            <span>{match.locked ? "Locked" : "Open"}</span>
          </div>
          <div className="text-white/70 text-xs">Tap To Open</div>
        </div>
      </div>
    </Card>
  );
}

// -----------------------
// Match Page + Score Entry
// -----------------------
function frontBackButtons({ activeHole, setActiveHole }) {
  return (
    <div className="space-y-2">
      <div className="text-white/70 text-xs">Front</div>
      <div className="grid grid-cols-9 gap-1">
        {Array.from({ length: 9 }, (_, i) => i + 1).map((h) => (
          <button
            key={h}
            onClick={() => setActiveHole(h)}
            className={`h-8 rounded-lg border text-xs font-semibold ${
              activeHole === h ? "bg-white text-zinc-900 border-white" : "bg-white/5 text-white/80 border-white/10 hover:bg-white/10"
            }`}
          >
            {h}
          </button>
        ))}
      </div>
      <div className="text-white/70 text-xs mt-3">Back</div>
      <div className="grid grid-cols-9 gap-1">
        {Array.from({ length: 9 }, (_, i) => i + 10).map((h) => (
          <button
            key={h}
            onClick={() => setActiveHole(h)}
            className={`h-8 rounded-lg border text-xs font-semibold ${
              activeHole === h ? "bg-white text-zinc-900 border-white" : "bg-white/5 text-white/80 border-white/10 hover:bg-white/10"
            }`}
          >
            {h}
          </button>
        ))}
      </div>
    </div>
  );
}

function MatchPage({ tournament, match, day, playersById, claimedPlayerId, isAdmin, onBack, writeMatch }) {
  const holes = tournament.courses?.[day.day]?.holes || [];
  const [activeHole, setActiveHole] = useState(1);

  const computed = useMemo(() => {
  const mh = computeMatchHoles(match, holes, playersById);

  const status =
    match.format === "SCRAMBLE_STABLEFORD"
      ? stablefordTotalsStatusFromHoles(mh, match.sideA.id, match.sideB.id)
      : matchStatusFromHoles(
          mh.map((x) => ({ played: x.played, winnerSideId: x.winnerSideId })),
          match.sideA.id,
          match.sideB.id
        );

  const pts = pointsForFinalMatch(status, match.sideA, match.sideB);

  return { holes: mh, status, points: pts };
}, [match, holes, playersById]);

  const me = claimedPlayerId ? playersById[claimedPlayerId] : null;
  const isParticipant = !!me && (match.sideA.playerIds.includes(me.id) || match.sideB.playerIds.includes(me.id));

  function canEditPlayer(pid) {
    if (isAdmin) return true;
    if (!me) return false;
    if (!isParticipant) return false;

    if (match.format === "SINGLES_NET") return pid === me.id;

    // Fourball: allow editing for your team's players in your match
    const p = playersById[pid];
    if (!p) return false;
    return p.teamId === me.teamId && (match.sideA.playerIds.includes(pid) || match.sideB.playerIds.includes(pid));
  }

  function canEditSide(sideId) {
    if (isAdmin) return true;
    if (!me) return false;
    if (!isParticipant) return false;
    if (match.format !== "SCRAMBLE_STABLEFORD") return false;
    const side = sideId === match.sideA.id ? match.sideA : match.sideB;
    return side.teamId === me.teamId;
  }

  async function setFourballGross(pid, holeNum, gross) {
    const next = { ...(match.fourballGrossByPlayer || {}) };
    const per = { ...(next[pid] || {}) };
    if (gross == null) delete per[holeNum];
    else per[holeNum] = gross;
    next[pid] = per;
    await writeMatch(match.id, { fourballGrossByPlayer: next });
  }

  async function setSinglesGross(pid, holeNum, gross) {
    const next = { ...(match.singlesGrossByPlayer || {}) };
    const per = { ...(next[pid] || {}) };
    if (gross == null) delete per[holeNum];
    else per[holeNum] = gross;
    next[pid] = per;
    await writeMatch(match.id, { singlesGrossByPlayer: next });
  }

  async function setScrambleGross(sideId, holeNum, gross) {
    const next = { ...(match.scrambleGrossBySide || {}) };
    const per = { ...(next[sideId] || {}) };
    if (gross == null) delete per[holeNum];
    else per[holeNum] = gross;
    next[sideId] = per;
    await writeMatch(match.id, { scrambleGrossBySide: next });
  }

  const holeMeta = holes[activeHole - 1] || { par: 0, hcpRank: 0 };
  const holeComputed = computed.holes[activeHole - 1] || { played: false, details: {} };

  return (
    <>
      <TopBar
        title={`Match ${match.matchNo}`}
        subtitle={`Day ${day.day} • ${tournament.courses?.[day.day]?.name || ""} • ${DAY_DATES[day.day]}`}
        left={
          <button onClick={onBack} className="text-white/80 hover:text-white inline-flex items-center gap-2">
            <ChevronLeft className="w-5 h-5" />
            <span className="hidden sm:inline">Matches</span>
          </button>
        }
        right={
          <>
            <Pill tone={statusPillTone(computed.status, match)}>{computed.status.text}</Pill>
            {isAdmin ? (
              <Pill>
                <Crown className="w-4 h-4" />
                Admin
              </Pill>
            ) : null}
          </>
        }
      />

      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-4">
            <Card className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-white font-semibold">Hole Selector</div>
                  <div className="text-white/60 text-xs mt-1">Front / Back</div>
                </div>
                <MatchFormatPill format={match.format} />
              </div>

              <div className="mt-4">{frontBackButtons({ activeHole, setActiveHole })}</div>

              <div className="mt-5 p-4 rounded-2xl bg-white/5 border border-white/10">
                <div className="text-white/70 text-xs">Active Hole</div>
                <div className="text-white font-semibold mt-1">Hole {activeHole}</div>
                <div className="text-white/60 text-xs mt-1">
                  Par {holeMeta.par} • HCP {holeMeta.hcpRank}
                </div>
              </div>

              <div className="mt-4 text-white/60 text-xs">
                {isAdmin ? "Admin can edit any score." : me ? "You can edit only permitted scores for your match." : "Spectator mode until you claim a profile."}
              </div>
            </Card>
          </div>

          <div className="lg:col-span-8 space-y-4">
            <Card className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-white font-semibold">
                    {TEAM.JC} vs {TEAM.SG}
                  </div>
                  <div className="text-white/60 text-xs mt-1">{day.title}</div>
                </div>
                <div className="flex items-center gap-2">
                  <TeamBadge teamId="JC" />
                  <TeamBadge teamId="SG" />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <div className="text-white/60 text-xs mb-2">{TEAM_ABBR.JC}</div>
                  <div className="text-white text-sm font-medium">
                    {match.sideA.playerIds.map((id) => playersById[id]?.name ?? "—").join(" / ")}
                  </div>
                </div>
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <div className="text-white/60 text-xs mb-2">{TEAM_ABBR.SG}</div>
                  <div className="text-white text-sm font-medium">
                    {match.sideB.playerIds.map((id) => playersById[id]?.name ?? "—").join(" / ")}
                  </div>
                </div>
              </div>

              {!me ? (
                <div className="mt-4 p-4 rounded-2xl bg-white/5 border border-white/10">
                  <div className="text-white/70 text-sm">Spectator Mode</div>
                  <div className="text-white/60 text-xs mt-1">Claim your profile to enter scores for your match.</div>
                </div>
              ) : null}
            </Card>

            {match.format === "FOURBALL_NET" ? (
              <FourballEntry
                match={match}
                activeHole={activeHole}
                holeMeta={holeMeta}
                playersById={playersById}
                holeComputed={holeComputed}
                setGross={setFourballGross}
                canEditPlayer={canEditPlayer}
              />
            ) : match.format === "SCRAMBLE_STABLEFORD" ? (
              <ScrambleEntry
                match={match}
                activeHole={activeHole}
                holeMeta={holeMeta}
                holeComputed={holeComputed}
                setGross={setScrambleGross}
                canEditSide={canEditSide}
              />
            ) : (
              <SinglesEntry
                match={match}
                activeHole={activeHole}
                holeMeta={holeMeta}
                playersById={playersById}
                holeComputed={holeComputed}
                setGross={setSinglesGross}
                canEditPlayer={canEditPlayer}
              />
            )}

            <MatchView holes={holes} match={match} computed={computed} onJumpToHole={(h) => setActiveHole(h)} />

            <Card className="p-5">
              <div className="text-white font-semibold">Match Points (Final Only)</div>
              <div className="text-white/60 text-xs mt-1">Ties split 0.5 / 0.5</div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <div className="text-white/70 text-xs">{TEAM_ABBR.JC}</div>
                  <div className="text-white text-2xl font-semibold mt-1">{(computed.points.JC ?? 0).toFixed(1)}</div>
                </div>
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <div className="text-white/70 text-xs">{TEAM_ABBR.SG}</div>
                  <div className="text-white text-2xl font-semibold mt-1">{(computed.points.SG ?? 0).toFixed(1)}</div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

function FourballEntry({ match, activeHole, holeMeta, playersById, holeComputed, setGross, canEditPlayer }) {
  const aPlayers = match.sideA.playerIds;
  const bPlayers = match.sideB.playerIds;

  function getGross(pid) {
    return match.fourballGrossByPlayer?.[pid]?.[activeHole] ?? null;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <TeamBadge teamId={match.sideA.teamId} />
            <Pill>Enter 2 Scores</Pill>
          </div>

          <div className="mt-4 space-y-4">
            {aPlayers.map((pid) => {
              const p = playersById[pid];
              const gross = getGross(pid);
              const net = p && gross != null ? netScore(gross, p.courseHcp, holeMeta.hcpRank) : null;
              const sr = p ? strokesReceivedOnHole(p.courseHcp, holeMeta.hcpRank) : 0;
              const editable = canEditPlayer(pid);

              return (
                <div key={pid} className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-white font-medium">{p?.name || "—"}</div>
                      <div className="text-white/60 text-xs">CH {p?.courseHcp ?? "—"} • Strokes This Hole: {sr}</div>
                    </div>
                    <NumberStepper value={gross} onChange={(v) => setGross(pid, activeHole, v)} min={1} max={12} disabled={!editable} />
                  </div>
                  <div className="mt-2 text-white/70 text-xs">Net: {net == null ? "—" : net}</div>
                  {!editable ? <div className="mt-2 text-white/50 text-[11px]">View-Only</div> : null}
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <TeamBadge teamId={match.sideB.teamId} />
            <Pill>Enter 2 Scores</Pill>
          </div>

          <div className="mt-4 space-y-4">
            {bPlayers.map((pid) => {
              const p = playersById[pid];
              const gross = getGross(pid);
              const net = p && gross != null ? netScore(gross, p.courseHcp, holeMeta.hcpRank) : null;
              const sr = p ? strokesReceivedOnHole(p.courseHcp, holeMeta.hcpRank) : 0;
              const editable = canEditPlayer(pid);

              return (
                <div key={pid} className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-white font-medium">{p?.name || "—"}</div>
                      <div className="text-white/60 text-xs">CH {p?.courseHcp ?? "—"} • Strokes This Hole: {sr}</div>
                    </div>
                    <NumberStepper value={gross} onChange={(v) => setGross(pid, activeHole, v)} min={1} max={12} disabled={!editable} />
                  </div>
                  <div className="mt-2 text-white/70 text-xs">Net: {net == null ? "—" : net}</div>
                  {!editable ? <div className="mt-2 text-white/50 text-[11px]">View-Only</div> : null}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="text-white font-semibold">Computed Best Ball</div>
        {holeComputed?.details?.type !== "fourball" || !holeComputed.played ? (
          <div className="mt-2 text-white/60 text-sm">Enter at least one gross score per side to compute best net.</div>
        ) : (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
              <div className="text-white/70 text-xs">{TEAM_ABBR[match.sideA.teamId]} Best</div>
              <div className="text-white font-medium mt-1">{playersById[holeComputed.details.aBest.pid]?.name}</div>
              <div className="text-white/70 text-sm mt-1">
                Gross {holeComputed.details.aBest.gross} • Net {holeComputed.details.aBest.net}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
              <div className="text-white/70 text-xs">{TEAM_ABBR[match.sideB.teamId]} Best</div>
              <div className="text-white font-medium mt-1">{playersById[holeComputed.details.bBest.pid]?.name}</div>
              <div className="text-white/70 text-sm mt-1">
                Gross {holeComputed.details.bBest.gross} • Net {holeComputed.details.bBest.net}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function ScrambleEntry({ match, activeHole, holeMeta, holeComputed, setGross, canEditSide }) {
  const aGross = match.scrambleGrossBySide?.[match.sideA.id]?.[activeHole] ?? null;
  const bGross = match.scrambleGrossBySide?.[match.sideB.id]?.[activeHole] ?? null;

  const aPts = aGross == null ? null : stablefordFromDiff(aGross - holeMeta.par);
  const bPts = bGross == null ? null : stablefordFromDiff(bGross - holeMeta.par);

  const canEditA = canEditSide(match.sideA.id);
  const canEditB = canEditSide(match.sideB.id);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <TeamBadge teamId={match.sideA.teamId} />
            <Pill>Team Score</Pill>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 p-4 rounded-2xl bg-white/5 border border-white/10">
            <div>
              <div className="text-white font-medium">Scramble Gross</div>
              <div className="text-white/60 text-xs">Stableford vs Par (No Handicaps)</div>
            </div>
            <NumberStepper value={aGross} onChange={(v) => setGross(match.sideA.id, activeHole, v)} min={1} max={12} disabled={!canEditA} />
          </div>
          <div className="mt-2 text-white/70 text-xs">Points: {aPts == null ? "—" : aPts}</div>
          {!canEditA ? <div className="mt-2 text-white/50 text-[11px]">View-Only</div> : null}
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <TeamBadge teamId={match.sideB.teamId} />
            <Pill>Team Score</Pill>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 p-4 rounded-2xl bg-white/5 border border-white/10">
            <div>
              <div className="text-white font-medium">Scramble Gross</div>
              <div className="text-white/60 text-xs">Stableford vs Par (No Handicaps)</div>
            </div>
            <NumberStepper value={bGross} onChange={(v) => setGross(match.sideB.id, activeHole, v)} min={1} max={12} disabled={!canEditB} />
          </div>
          <div className="mt-2 text-white/70 text-xs">Points: {bPts == null ? "—" : bPts}</div>
          {!canEditB ? <div className="mt-2 text-white/50 text-[11px]">View-Only</div> : null}
        </Card>
      </div>

      <Card className="p-4">
        <div className="text-white font-semibold">Computed Hole Comparison</div>
        {!holeComputed.played ? (
          <div className="mt-2 text-white/60 text-sm">Enter both team gross scores to compute the hole winner.</div>
        ) : (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
              <div className="text-white/70 text-xs">{TEAM_ABBR[match.sideA.teamId]}</div>
              <div className="text-white/80 text-sm mt-1">
                Gross {holeComputed.details.aGross} • Points {holeComputed.details.aPts}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
              <div className="text-white/70 text-xs">{TEAM_ABBR[match.sideB.teamId]}</div>
              <div className="text-white/80 text-sm mt-1">
                Gross {holeComputed.details.bGross} • Points {holeComputed.details.bPts}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function SinglesEntry({ match, activeHole, holeMeta, playersById, holeComputed, setGross, canEditPlayer }) {
  const aPid = match.sideA.playerIds[0];
  const bPid = match.sideB.playerIds[0];

  const a = playersById[aPid];
  const b = playersById[bPid];

  const aGross = match.singlesGrossByPlayer?.[aPid]?.[activeHole] ?? null;
  const bGross = match.singlesGrossByPlayer?.[bPid]?.[activeHole] ?? null;

  const aNet = aGross == null || !a ? null : netScore(aGross, a.courseHcp, holeMeta.hcpRank);
  const bNet = bGross == null || !b ? null : netScore(bGross, b.courseHcp, holeMeta.hcpRank);

  const aSr = a ? strokesReceivedOnHole(a.courseHcp, holeMeta.hcpRank) : 0;
  const bSr = b ? strokesReceivedOnHole(b.courseHcp, holeMeta.hcpRank) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <TeamBadge teamId={match.sideA.teamId} />
            <Pill>Player</Pill>
          </div>
          <div className="mt-4 p-4 rounded-2xl bg-white/5 border border-white/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-white font-medium">{a?.name || "—"}</div>
                <div className="text-white/60 text-xs">CH {a?.courseHcp ?? "—"} • Strokes This Hole: {aSr}</div>
              </div>
              <NumberStepper value={aGross} onChange={(v) => setGross(aPid, activeHole, v)} min={1} max={12} disabled={!canEditPlayer(aPid)} />
            </div>
            <div className="mt-2 text-white/70 text-xs">Net: {aNet == null ? "—" : aNet}</div>
            {!canEditPlayer(aPid) ? <div className="mt-2 text-white/50 text-[11px]">View-Only</div> : null}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <TeamBadge teamId={match.sideB.teamId} />
            <Pill>Player</Pill>
          </div>
          <div className="mt-4 p-4 rounded-2xl bg-white/5 border border-white/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-white font-medium">{b?.name || "—"}</div>
                <div className="text-white/60 text-xs">CH {b?.courseHcp ?? "—"} • Strokes This Hole: {bSr}</div>
              </div>
              <NumberStepper value={bGross} onChange={(v) => setGross(bPid, activeHole, v)} min={1} max={12} disabled={!canEditPlayer(bPid)} />
            </div>
            <div className="mt-2 text-white/70 text-xs">Net: {bNet == null ? "—" : bNet}</div>
            {!canEditPlayer(bPid) ? <div className="mt-2 text-white/50 text-[11px]">View-Only</div> : null}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="text-white font-semibold">Computed Comparison</div>
        {!holeComputed.played ? (
          <div className="mt-2 text-white/60 text-sm">Enter both players’ gross scores to compute the hole winner.</div>
        ) : (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
              <div className="text-white/70 text-xs">{TEAM_ABBR[match.sideA.teamId]}</div>
              <div className="text-white/80 text-sm mt-1">
                Gross {holeComputed.details.aGross} • Net {holeComputed.details.aNet}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
              <div className="text-white/70 text-xs">{TEAM_ABBR[match.sideB.teamId]}</div>
              <div className="text-white/80 text-sm mt-1">
                Gross {holeComputed.details.bGross} • Net {holeComputed.details.bNet}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function MatchView({ holes, match, computed, onJumpToHole }) {
  const header =
    match.format === "FOURBALL_NET"
      ? "Fourball (Net): team uses best net of its two players each hole"
      : match.format === "SCRAMBLE_STABLEFORD"
      ? "Scramble (Stableford): compare Stableford points each hole (no handicaps)"
      : "Singles (Net): compare net scores each hole";

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-white font-semibold">Hole-By-Hole</div>
          <div className="text-white/60 text-xs mt-1">{header}</div>
        </div>
        <Pill tone={statusPillTone(computed.status, match)}>{computed.status.text}</Pill>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[900px] w-full text-sm">
          <thead>
            <tr className="text-white/70">
              <th className="text-left py-2">Hole</th>
              <th className="text-left py-2">Par</th>
              <th className="text-left py-2">HCP</th>
              <th className="text-left py-2">JCGC</th>
              <th className="text-left py-2">SGC</th>
              <th className="text-left py-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {computed.holes.map((h) => {
              const meta = holes[h.hole - 1] || { par: "—", hcpRank: "—" };
              const res = !h.played ? "—" : h.winnerSideId == null ? "½" : h.winnerSideId.endsWith("-A") ? "JCGC" : "SGC";

              let aVal = "—";
              let bVal = "—";

              if (h.details.type === "fourball" && h.played) {
                aVal = `Net ${h.details.aBest.net}`;
                bVal = `Net ${h.details.bBest.net}`;
              }
              if (h.details.type === "scramble" && h.played) {
                aVal = `${h.details.aPts} Pts (G${h.details.aGross})`;
                bVal = `${h.details.bPts} Pts (G${h.details.bGross})`;
              }
              if (h.details.type === "singles" && h.played) {
                aVal = `Net ${h.details.aNet} (G${h.details.aGross})`;
                bVal = `Net ${h.details.bNet} (G${h.details.bGross})`;
              }

              const pillTone = res === "JCGC" ? "jcLead" : res === "SGC" ? "sgLead" : res === "½" ? "warn" : "neutral";

              return (
                <tr
                  key={h.hole}
                  className="border-t border-white/10 hover:bg-white/5 cursor-pointer"
                  onClick={() => onJumpToHole(h.hole)}
                >
                  <td className="py-3 text-white font-medium">{h.hole}</td>
                  <td className="py-3 text-white/80">{meta.par}</td>
                  <td className="py-3 text-white/80">{meta.hcpRank}</td>
                  <td className="py-3 text-white/80">{aVal}</td>
                  <td className="py-3 text-white/80">{bVal}</td>
                  <td className="py-3">
                    <Pill tone={pillTone}>{res}</Pill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-white/60 text-xs">Tip: click any row to jump to that hole in score entry.</div>
    </Card>
  );
}

// -----------------------
// Broadcast
// -----------------------
function BroadcastPage({ tournament, totals, playersById, onExit, onOpenMatch }) {
  const [day, setDay] = useState(1);
  const d = totals.daySummaries.find((x) => x.day === day);

  return (
    <>
      <TopBar
        title="Broadcast"
        subtitle="Live match tiles + team totals"
        left={
          <button onClick={onExit} className="text-white/80 hover:text-white inline-flex items-center gap-2">
            <ChevronLeft className="w-5 h-5" />
            <span className="hidden sm:inline">Home</span>
          </button>
        }
        right={
          <Pill>
            <Tv className="w-4 h-4" />
            Live
          </Pill>
        }
      />

      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatBlock
  label={TEAM.JC}
  value={totals.totalJC.toFixed(1)}
  sub="Overall"
  logoSrc="/jc-logo.png?v=2"
/>

<StatBlock
  label={TEAM.SG}
  value={totals.totalSG.toFixed(1)}
  sub="Overall"
  logoSrc="/sg-logo.png?v=2"
/>
          <StatBlock label={`Day ${day}`} value={`${(d?.jc ?? 0).toFixed(1)}–${(d?.sg ?? 0).toFixed(1)}`} sub={DAY_DATES[day]} />
        </div>

        <div className="mt-4">
          <Segmented
            value={day}
            onChange={setDay}
            options={(tournament.days || []).map((x) => ({
              value: x.day,
              label: `Day ${x.day}`,
              icon: null,
            }))}
          />
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {(d?.matchCards || []).map((mc) => (
            <MatchCard key={mc.match.id} mc={mc} playersById={playersById} broadcast onOpen={() => onOpenMatch(mc.match.id)} />
          ))}
        </div>
      </div>
    </>
  );
}

// -----------------------
// Admin Page (Firestore roles)
// -----------------------
function AdminPage({
  tournament,
  userId,
  isAdmin,
  onBack,
  writePlayer,
  writeMatch,
  addAdminUid,
  removeAdminUid,
  addPlayer,
}) {
  const [tab, setTab] = useState("roster");
  const [newAdminUid, setNewAdminUid] = useState("");

  const isOwner = !!userId && userId === tournament.ownerUserId;

  const jcPlayers = tournament.players.filter((p) => p.teamId === "JC");
  const sgPlayers = tournament.players.filter((p) => p.teamId === "SG");

  async function patchPlayer(pid, patch) {
    await writePlayer(pid, patch);
  }

  async function patchMatch(_dayNum, matchId, patch) {
    await writeMatch(matchId, patch);
  }

  return (
    <>
      <TopBar
        title="Admin"
        subtitle={`Owner/Admin Only • ${TOURNAMENT_TITLE}`}
        left={
          <button onClick={onBack} className="text-white/80 hover:text-white inline-flex items-center gap-2">
            <ChevronLeft className="w-5 h-5" />
            <span className="hidden sm:inline">Home</span>
          </button>
        }
        right={
          <Pill>
            <Shield className="w-4 h-4" />
            {userId ? "Admin Session" : "Public Viewer"}
          </Pill>
        }
      />

      <div className="max-w-6xl mx-auto px-4 py-6">
        {!isAdmin ? (
          <Card className="p-6">
            <div className="text-white font-semibold">Access Denied</div>
            <div className="text-white/60 text-sm mt-2">This page is restricted to the owner and designated admins.</div>
          </Card>
        ) : (
          <>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "roster", label: "Roster", icon: <Users className="w-4 h-4" /> },
                { value: "schedule", label: "Matches", icon: <Flag className="w-4 h-4" /> },
                { value: "admins", label: "Admins", icon: <Crown className="w-4 h-4" /> },
              ]}
            />

            {tab === "roster" ? (
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-white font-semibold">Players</div>
                    <div className="text-white/60 text-xs mt-1">Edit names, handicaps, and team assignment.</div>
                  </div>
                  <Button onClick={addPlayer}>Add Player</Button>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {tournament.players.map((p) => (
                    <div key={p.id} className="p-4 rounded-2xl bg-white/5 border border-white/10">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-white text-sm font-medium">{p.name}</div>
                          <div className="text-white/60 text-xs mt-1">ID: {p.id}</div>
                        </div>
                        <TeamBadge teamId={p.teamId} />
                      </div>

                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input
                          value={p.name}
                          onChange={(e) => patchPlayer(p.id, { name: e.target.value })}
                          className="sm:col-span-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm"
                        />
                        <input
                          value={p.courseHcp}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isFinite(n)) return;
                            patchPlayer(p.id, { courseHcp: clamp(Math.round(n), 0, 40) });
                          }}
                          className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm"
                        />
                      </div>

                      <div className="mt-2">
                        <select
                          value={p.teamId}
                          onChange={(e) => patchPlayer(p.id, { teamId: e.target.value })}
                          className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm"
                        >
                          <option value="JC">{TEAM.JC}</option>
                          <option value="SG">{TEAM.SG}</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : tab === "schedule" ? (
              <div className="mt-4 space-y-4">
                {tournament.days.map((d) => (
                  <Card key={d.day} className="p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-white font-semibold">
                          Day {d.day} • {d.date}
                        </div>
                        <div className="text-white/60 text-xs mt-1">{d.title}</div>
                      </div>
                      <Pill>{tournament.courses?.[d.day]?.name}</Pill>
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                      {d.matches.map((m) => (
                        <div key={m.id} className="p-4 rounded-2xl bg-white/5 border border-white/10">
                          <div className="flex items-center justify-between">
                            <div className="text-white/70 text-xs">Match {m.matchNo}</div>
                            <MatchFormatPill format={m.format} />
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-2">
                            <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
                              <div className="text-white/70 text-xs mb-2">{TEAM.JC}</div>
                              {m.format === "SINGLES_NET" ? (
                                <select
                                  value={m.sideA.playerIds[0]}
                                  onChange={(e) =>
                                    patchMatch(d.day, m.id, {
                                      sideA: { ...m.sideA, playerIds: [e.target.value] },
                                    })
                                  }
                                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm"
                                >
                                  {jcPlayers.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name} (CH {p.courseHcp})
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {[0, 1].map((idx) => (
                                    <select
                                      key={idx}
                                      value={m.sideA.playerIds[idx]}
                                      onChange={(e) => {
                                        const next = [...m.sideA.playerIds];
                                        next[idx] = e.target.value;
                                        patchMatch(d.day, m.id, { sideA: { ...m.sideA, playerIds: next } });
                                      }}
                                      className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm"
                                    >
                                      {jcPlayers.map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {p.name} (CH {p.courseHcp})
                                        </option>
                                      ))}
                                    </select>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
                              <div className="text-white/70 text-xs mb-2">{TEAM.SG}</div>
                              {m.format === "SINGLES_NET" ? (
                                <select
                                  value={m.sideB.playerIds[0]}
                                  onChange={(e) =>
                                    patchMatch(d.day, m.id, {
                                      sideB: { ...m.sideB, playerIds: [e.target.value] },
                                    })
                                  }
                                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm"
                                >
                                  {sgPlayers.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name} (CH {p.courseHcp})
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {[0, 1].map((idx) => (
                                    <select
                                      key={idx}
                                      value={m.sideB.playerIds[idx]}
                                      onChange={(e) => {
                                        const next = [...m.sideB.playerIds];
                                        next[idx] = e.target.value;
                                        patchMatch(d.day, m.id, { sideB: { ...m.sideB, playerIds: next } });
                                      }}
                                      className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm"
                                    >
                                      {sgPlayers.map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {p.name} (CH {p.courseHcp})
                                        </option>
                                      ))}
                                    </select>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="mt-4">
                <Card className="p-5">
                  <div className="text-white font-semibold">Admin Roles</div>
                  <div className="text-white/60 text-xs mt-1">Only the owner can add/remove admin Firebase UIDs.</div>

                  <div className="mt-4 p-4 rounded-2xl bg-white/5 border border-white/10">
                    <div className="text-white/80 text-sm">
                      Owner UID: <b>{tournament.ownerUserId || "—"}</b>
                    </div>
                    <div className="text-white/60 text-xs mt-1">
                      Admin UIDs: {(tournament.adminUserIds || []).join(", ") || "—"}
                    </div>
                  </div>

                  {!isOwner ? (
                    <div className="mt-3 text-white/60 text-sm">Only the owner can edit admin roles.</div>
                  ) : (
                    <>
                      <div className="mt-4 flex gap-2">
                        <input
                          value={newAdminUid}
                          onChange={(e) => setNewAdminUid(e.target.value)}
                          placeholder="Paste Firebase UID here"
                          className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm"
                        />
                        <Button
                          onClick={async () => {
                            await addAdminUid(newAdminUid);
                            setNewAdminUid("");
                          }}
                        >
                          Add
                        </Button>
                      </div>

                      <div className="mt-4 space-y-2">
                        {(tournament.adminUserIds || [])
                          .filter((uid) => uid && uid !== tournament.ownerUserId)
                          .map((uid) => (
                            <div key={uid} className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/10">
                              <div className="text-white/80 text-sm">{uid}</div>
                              <Button variant="danger" onClick={() => removeAdminUid(uid)}>
                                Remove
                              </Button>
                            </div>
                          ))}
                      </div>
                    </>
                  )}
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
