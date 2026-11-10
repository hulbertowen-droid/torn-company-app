/**
 * Faction Gym & Battle Stat Tracker - Core TypeScript Definitions
 * 
 * Provides strong typing for Torn City API v1 & v2 gym, battlestat,
 * energy utilization, and faction analytics models.
 */

export type StatType = 'strength' | 'speed' | 'defense' | 'dexterity';

export type StatArchetype = 
  | 'HankBalanced'       // Hank's Ratio (~25% each or balanced 4:3:3:3 defense focus)
  | 'StrengthSpecialist' // Strength > 40-50% of total
  | 'SpeedSpecialist'    // Speed > 40-50% of total
  | 'DefenseTank'        // Defense > 40-50% of total + high life
  | 'DexterityGhost'     // Dexterity > 40-50% of total
  | 'GlassCannon';       // High Strength + High Speed with minimal Def/Dex

export type PrivacyTier = 'full' | 'gains_only' | 'leadership_only';

export type WarRole = 'FrontlineBreaker' | 'BunkerTank' | 'BalancedFlex';

export type ContestTargetType = 'total_gain' | 'pct_gain' | 'stat_gain' | 'energy_spent';

export type ContestStatus = 'upcoming' | 'active' | 'completed';

export interface BattleStatsValues {
  strength: number;
  speed: number;
  defense: number;
  dexterity: number;
  total: number;
}

export interface BattleStatsModifiers {
  strength: number;
  speed: number;
  defense: number;
  dexterity: number;
}

export interface StatBalanceBreakdown {
  strengthPct: number;
  speedPct: number;
  defensePct: number;
  dexterityPct: number;
}

export interface EnergyUtilizationStats {
  energySpentEst: number;
  xanaxTakenCount: number;
  refillUsed: boolean;
  cansUsedCount: number;
  fhcUsedCount: number;
  happyJumpsCount: number;
  efficiencyScore: number; // 0 - 100%
  theoreticalMaxEnergy: number;
}

export interface SlackerAssessment {
  isSlacking: boolean;
  zeroTrainHours: number;
  energyCapped: boolean;
  quotaMet: boolean;
  weeklyEnergySpent: number;
  weeklyQuota: number;
  warningReasons: string[];
}

export interface MemberStatSnapshot {
  timestamp: number;
  strength: number;
  speed: number;
  defense: number;
  dexterity: number;
  total: number;
  gains?: {
    strength: number;
    speed: number;
    defense: number;
    dexterity: number;
    total: number;
    pct?: number;
  };
  energySpent?: number;
  xanaxTaken?: number;
}

export interface MemberGainsSummary {
  gain24h: BattleStatsValues;
  gain7d: BattleStatsValues;
  gain30d: BattleStatsValues;
  customGain?: BattleStatsValues;
  pct24h: number;
  pct7d: number;
  pct30d: number;
  dailyAverageGain: number;
}

export interface FactionMemberTrackerRecord {
  playerId: number;
  playerName: string;
  level: number;
  role: string;
  daysInFaction: number;
  onlineStatus: 'online' | 'idle' | 'offline';
  lastActionTimestamp: number;
  stats: BattleStatsValues;
  modifiers: BattleStatsModifiers;
  archetype: StatArchetype;
  balance: StatBalanceBreakdown;
  gains: MemberGainsSummary;
  energy: EnergyUtilizationStats;
  slacker: SlackerAssessment;
  privacy: PrivacyTier;
  verified: boolean;
  history: MemberStatSnapshot[];
  targetGoal?: {
    stat: StatType | 'total';
    targetValue: number;
    currentValue: number;
    progressPct: number;
    title: string;
  };
}

export interface SteadfastPerks {
  strengthBonusPct: number;
  speedBonusPct: number;
  defenseBonusPct: number;
  dexterityBonusPct: number;
}

export interface FactionGymKPIs {
  totalBattleStats: number;
  averageBattleStats: number;
  totalGains24h: number;
  totalGains7d: number;
  totalGains30d: number;
  activeTrainersToday: number;
  activeTrainersPct: number;
  avgXanaxPerDay: number;
  totalXanax24h: number;
  totalRefills24h: number;
  slackerCount: number;
  trackedMembersCount: number;
  totalMembersCount: number;
}

export interface ContestLeaderboardEntry {
  rank: number;
  playerId: number;
  playerName: string;
  avatarUrl?: string;
  baselineValue: number;
  currentValue: number;
  score: number; // Net gain, % gain, or energy
  scoreFormatted: string;
  progressPct: number;
  rewardTier?: string;
  rewardAmount?: number;
}

export interface FactionContest {
  id: string;
  title: string;
  description: string;
  targetType: ContestTargetType;
  targetStat?: StatType | null;
  startTime: number;
  endTime: number;
  prizePool: number;
  prizeDescription?: string;
  creatorId: number;
  creatorName: string;
  status: ContestStatus;
  leaderboard: ContestLeaderboardEntry[];
  totalExpendedInContest: number;
}

export interface FairFightTargetMatch {
  enemyPlayerId: number;
  enemyPlayerName: string;
  enemyTotalStats: number;
  recommendedAttackers: Array<{
    playerId: number;
    playerName: string;
    playerTotalStats: number;
    fairFightMultiplier: number; // 1.0 - 3.0
    winProbabilityEst: number; // 0 - 100%
    recommendedRole: WarRole;
  }>;
}

export interface GymTrackerDashboardPayload {
  success: boolean;
  factionId: number;
  factionName: string;
  lastUpdated: number;
  kpis: FactionGymKPIs;
  steadfast: SteadfastPerks;
  activeContests: FactionContest[];
  velocityChart: {
    dates: string[];
    factionTotals: number[];
    dailyGains: number[];
  };
  radarAverages: StatBalanceBreakdown;
}

export interface GymTrackerRosterPayload {
  success: boolean;
  timeframe: '24h' | '7d' | '30d' | 'custom';
  customStart?: number;
  customEnd?: number;
  members: FactionMemberTrackerRecord[];
  totalMembers: number;
}

export interface MemberDossierPayload {
  success: boolean;
  member: FactionMemberTrackerRecord;
  radar: StatBalanceBreakdown;
  factionAverageRadar: StatBalanceBreakdown;
  timeline30d: Array<{
    date: string;
    timestamp: number;
    strength: number;
    speed: number;
    defense: number;
    dexterity: number;
    total: number;
    gain: number;
    energySpentEst: number;
  }>;
  projections: {
    dailyVelocity: number;
    projected30d: number;
    projected90d: number;
    daysToNextMilestone: number;
    nextMilestoneTitle: string;
  };
}
