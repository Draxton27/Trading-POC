export type Candle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type BollingerPoint = {
  timestamp: string;
  close: number;
  middle: number | null;
  upper: number | null;
  lower: number | null;
  bandwidth: number | null; // razon: 0.08 equivale al 8 %
};

export type Direction = 'CALL_CONTEXT' | 'PUT_CONTEXT';
export type Signal = {
  index: number;
  timestamp: string;
  direction: Direction;
  close: number;
  previousBandwidthPercent: number;
  currentBandwidthPercent: number;
  squeezeThresholdPercent: number;
};

export type Outcome = {
  signal: Signal;
  horizon: number;
  signedReturnPercent: number;
  favored: boolean;
};
