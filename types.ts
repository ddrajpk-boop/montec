
export interface BatteryManager extends EventTarget {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
  onchargingchange: ((this: BatteryManager, ev: Event) => any) | null;
  onchargingtimechange: ((this: BatteryManager, ev: Event) => any) | null;
  ondischargingtimechange: ((this: BatteryManager, ev: Event) => any) | null;
  onlevelchange: ((this: BatteryManager, ev: Event) => any) | null;
}

export interface ChargingLog {
  timestamp: number;
  level: number;
  wattage: number;
  voltage: number;
  amperage: number;
  status: 'charging' | 'discharging';
}

export interface SessionStats {
  startTime: number;
  endTime: number | null;
  startLevel: number;
  endLevel: number | null;
  avgWattage: number;
  maxWattage: number;
  avgVoltage: number;
  maxAmperage: number;
  totalEnergyWh: number;
}
