// src/tournamentPrototype.js
// Pure JS tournament logic (no React / no UI)

export const TOURNAMENT_TITLE = "FRELLIS CUP 2026";
export const TOURNAMENT_SUBTITLE = "Live Scoring Prototype — Player Entry + Real-Time Standings";

export const DAY_DATES = {
  1: "March 5, 2026",
  2: "March 6, 2026",
  3: "March 7, 2026",
};

export const TEAM = {
  JC: "Jumping Chollas",
  SG: "Saguaros",
};

export const TEAM_ABBR = {
  JC: "JCGC",
  SG: "SGC",
};

export const TEAM_COLOR = {
  // Requested: JCGC = red, SGC = yellow
  JC: "bg-red-500/20 text-red-100 border-red-400/30",
  SG: "bg-yellow-400/20 text-yellow-100 border-yellow-300/30",
};

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function stablefordFromDiff(diff) {
  // diff = gross - par
  if (diff <= -3) return 10; // Double Eagle Or Better
  if (diff === -2) return 6; // Eagle
  if (diff === -1) return 3; // Birdie
  if (diff === 0) return 1; // Par
  if (diff === 1) return -1; // Bogey
  return -2; // Double Bogey Or Worse
}

export function strokesReceivedOnHole(courseHcp, holeHcpRank) {
  const full = Math.floor(courseHcp / 18);
  const rem = courseHcp % 18;
  const extra = holeHcpRank <= rem ? 1 : 0;
  return full + extra;
}

export function netScore(gross, courseHcp, holeHcpRank) {
  if (gross == null) return null;
  const sr = strokesReceivedOnHole(courseHcp, holeHcpRank);
  return gross - sr;
}

export function matchStatusFromHoles(holes, sideAId, sideBId) {
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

export function pointsForFinalMatch(status, sideA, sideB) {
  if (!status.isFinal) return { [sideA.teamId]: 0, [sideB.teamId]: 0 };
  if (status.text.includes("Tied")) {
    return { [sideA.teamId]: 0.5, [sideB.teamId]: 0.5 };
  }
  const winnerSideId = status.leaderSideId;
  const winnerTeam = winnerSideId === sideA.id ? sideA.teamId : sideB.teamId;
  const loserTeam = winnerTeam === sideA.teamId ? sideB.teamId : sideA.teamId;
  return { [winnerTeam]: 1, [loserTeam]: 0 };
}

// -----------------------
// Courses (auto-filled scorecards)
// -----------------------
export function holesFromParAndHcp(parArr, hcpArr) {
  return parArr.map((par, i) => ({ hole: i + 1, par, hcpRank: hcpArr[i] }));
}

export const COURSES = {
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