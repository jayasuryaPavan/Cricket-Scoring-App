
export interface BallEvent {
  display: string;
  runs: number;
  isWicket: boolean;
  isLegalDelivery: boolean;
  extraType?: 'wide' | 'no_ball';
}

export interface ScoreState {
  runs: number;
  wickets: number;
  overs: number;
  balls: number;
  recentThisOver: BallEvent[];
  inningsOver: boolean;
  targetOvers: number;
  maxWickets: number;
}
