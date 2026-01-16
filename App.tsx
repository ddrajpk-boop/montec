
import React, { useState, useEffect, useRef } from 'react';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area,
  Line
} from 'recharts';
import { BatteryManager, ChargingLog, SessionStats } from './types';
import { 
  BoltIcon, BatteryIcon, ChartIcon, InfoIcon, 
  VoltageIcon, AmpsIcon, EllipsisIcon, SunIcon, MoonIcon 
} from './components/Icons';
import { getChargingInsights } from './services/geminiService';

const BATTERY_CAPACITY_WH = 19.25; // Typical 5000mAh battery at 3.85V
const TOTAL_MAH = 5000;
const MAX_STORED_SESSIONS = 5;

const App: React.FC = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('vf-theme') as 'dark' | 'light') || 'dark';
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [battery, setBattery] = useState<BatteryManager | null>(null);
  const [isCharging, setIsCharging] = useState(false);
  const [level, setLevel] = useState(0);
  const [metrics, setMetrics] = useState({ watts: 0, volts: 0, amps: 0 });
  const [history, setHistory] = useState<ChargingLog[]>([]);
  const [session, setSession] = useState<SessionStats | null>(null);
  const [pastSessions, setPastSessions] = useState<SessionStats[]>(() => {
    const saved = localStorage.getItem('vf-sessions');
    return saved ? JSON.parse(saved) : [];
  });
  const [aiInsight, setAiInsight] = useState<string>('');
  const [isLoadingInsight, setIsLoadingInsight] = useState(false);
  const [unsupportedBrowser, setUnsupportedBrowser] = useState(false);

  const lastUpdateRef = useRef<{ time: number; level: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Initialize Battery API
  useEffect(() => {
    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((batt: BatteryManager) => {
        setBattery(batt);
        setIsCharging(batt.charging);
        setLevel(batt.level);

        const updateStatus = () => {
          setIsCharging(batt.charging);
          setLevel(batt.level);
        };

        batt.addEventListener('chargingchange', updateStatus);
        batt.addEventListener('levelchange', updateStatus);

        return () => {
          batt.removeEventListener('chargingchange', updateStatus);
          batt.removeEventListener('levelchange', updateStatus);
        };
      });
    } else {
      setUnsupportedBrowser(true);
    }
  }, []);

  // Theme Persistence
  useEffect(() => {
    document.documentElement.className = theme;
    localStorage.setItem('vf-theme', theme);
    const metaThemeColor = document.getElementById('theme-meta');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', theme === 'dark' ? '#0f172a' : '#f8fafc');
    }
  }, [theme]);

  // Session Storage Persistence
  useEffect(() => {
    if (pastSessions.length > 0) {
      localStorage.setItem('vf-sessions', JSON.stringify(pastSessions.slice(0, MAX_STORED_SESSIONS)));
    }
  }, [pastSessions]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const estimateElectricalProperties = (watts: number) => {
    let volts = 5.0;
    if (watts > 25) volts = 12.0;
    else if (watts > 12) volts = 9.0;
    else if (watts > 0) volts = 5.0;
    const jitter = (Math.random() - 0.5) * 0.1;
    const stableVolts = volts + (watts > 0 ? jitter : 0);
    const amps = watts > 0 ? watts / stableVolts : 0;
    return { volts: stableVolts, amps };
  };

  useEffect(() => {
    if (isCharging) {
      if (!session || session.endTime !== null) {
        setSession({
          startTime: Date.now(),
          endTime: null,
          startLevel: level,
          endLevel: null,
          avgWattage: 0,
          maxWattage: 0,
          avgVoltage: 0,
          maxAmperage: 0,
          totalEnergyWh: 0
        });
      }

      const now = Date.now();
      if (lastUpdateRef.current && lastUpdateRef.current.level !== level) {
        const deltaLevel = level - lastUpdateRef.current.level;
        const deltaTimeHours = (now - lastUpdateRef.current.time) / (1000 * 60 * 60);
        
        if (deltaTimeHours > 0) {
          const wattage = (deltaLevel * BATTERY_CAPACITY_WH) / deltaTimeHours;
          const cleanWattage = Math.min(Math.max(wattage, 0), 120); 
          const { volts, amps } = estimateElectricalProperties(cleanWattage);
          
          setMetrics({ watts: cleanWattage, volts, amps });
          setHistory(prev => [...prev.slice(-49), { 
            timestamp: now, 
            level: level * 100, 
            wattage: cleanWattage,
            voltage: volts,
            amperage: amps,
            status: 'charging'
          }]);

          setSession(prev => {
            if (!prev) return null;
            const newMaxW = Math.max(prev.maxWattage, cleanWattage);
            const newMaxA = Math.max(prev.maxAmperage, amps);
            const newAvgW = prev.avgWattage === 0 ? cleanWattage : (prev.avgWattage + cleanWattage) / 2;
            const newAvgV = prev.avgVoltage === 0 ? volts : (prev.avgVoltage + volts) / 2;
            return { 
              ...prev, 
              maxWattage: newMaxW, 
              avgWattage: newAvgW, 
              avgVoltage: newAvgV, 
              maxAmperage: newMaxA 
            };
          });
        }
      }
      if (!lastUpdateRef.current || lastUpdateRef.current.level !== level) {
        lastUpdateRef.current = { time: now, level };
      }
    } else {
      if (session && session.endTime === null) {
        const finalSession = { ...session, endTime: Date.now(), endLevel: level };
        setSession(finalSession);
        setPastSessions(prev => [finalSession, ...prev].slice(0, MAX_STORED_SESSIONS));
        triggerAiAnalysis(finalSession);
      }
      setMetrics({ watts: 0, volts: 0, amps: 0 });
      lastUpdateRef.current = null;
    }
  }, [isCharging, level]);

  const triggerAiAnalysis = async (stats: SessionStats) => {
    setIsLoadingInsight(true);
    const data = history.map(h => ({
      time: new Date(h.timestamp).toLocaleTimeString(),
      level: h.level,
      wattage: h.wattage,
      voltage: h.voltage,
      amperage: h.amperage
    }));
    const insight = await getChargingInsights(data, stats.avgWattage, stats.maxWattage);
    setAiInsight(insight || '');
    setIsLoadingInsight(false);
  };

  const formattedChartData = history.map(h => ({
    time: new Date(h.timestamp).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' }),
    wattage: parseFloat(h.wattage.toFixed(1)),
    voltage: parseFloat(h.voltage.toFixed(2)),
    amperage: parseFloat(h.amperage.toFixed(2)),
    level: h.level
  }));

  const currentMah = (level * TOTAL_MAH).toFixed(0);

  return (
    <div className={`min-h-screen transition-colors duration-500 flex flex-col items-center pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]
      ${theme === 'dark' ? 'bg-[#0f172a] text-slate-100' : 'bg-[#f8fafc] text-slate-900'}`}>
      
      <div className="w-full max-w-5xl px-4 py-6 space-y-6">
        <header className="flex justify-between items-center px-1">
          <div className="flex items-center gap-2.5">
            <div className="bg-sky-500 p-2 rounded-xl shadow-lg shadow-sky-500/20 text-white">
              <BoltIcon className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight leading-none uppercase italic">VoltFlow</h1>
              <span className="text-[9px] uppercase tracking-widest font-bold opacity-40">Industrial Core v2.7</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className={`flex px-3 py-1.5 rounded-full border items-center gap-2 text-[9px] font-black uppercase tracking-widest
              ${theme === 'dark' ? 'bg-slate-800/80 border-slate-700/50' : 'bg-white border-slate-200 shadow-sm'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${isCharging ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-slate-500'}`} />
              <span>{isCharging ? 'LINK ACTIVE' : 'STANDBY'}</span>
            </div>
            
            <div className="relative" ref={menuRef}>
              <button onClick={() => setIsMenuOpen(!isMenuOpen)} className={`p-2.5 rounded-xl transition-all border ${theme === 'dark' ? 'active:bg-slate-700 border-slate-700/50' : 'active:bg-slate-100 border-slate-200'}`}>
                <EllipsisIcon className="w-6 h-6" />
              </button>
              {isMenuOpen && (
                <div className={`absolute right-0 mt-3 w-52 rounded-2xl border shadow-2xl z-50 overflow-hidden py-2 animate-in fade-in slide-in-from-top-2 ${theme === 'dark' ? 'bg-[#1e293b] border-slate-700' : 'bg-white border-slate-200'}`}>
                  <button onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setIsMenuOpen(false); }} className={`w-full px-5 py-4 flex items-center gap-3 text-xs font-bold uppercase tracking-widest active:scale-95 transition-transform ${theme === 'dark' ? 'active:bg-slate-800 text-slate-300' : 'active:bg-slate-50 text-slate-700'}`}>
                    {theme === 'dark' ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
                    {theme === 'dark' ? 'Day Theme' : 'Night Theme'}
                  </button>
                  <button onClick={() => { setPastSessions([]); localStorage.removeItem('vf-sessions'); setIsMenuOpen(false); }} className={`w-full px-5 py-4 flex items-center gap-3 text-xs font-bold uppercase tracking-widest text-rose-500 active:scale-95 transition-transform ${theme === 'dark' ? 'active:bg-slate-800' : 'active:bg-slate-50'}`}>
                    Clear Logs
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          <div className={`lg:col-span-2 rounded-[2rem] p-6 md:p-10 border transition-all relative overflow-hidden group ${theme === 'dark' ? 'bg-slate-900 border-slate-800 shadow-2xl' : 'bg-white border-slate-200 shadow-lg'}`}>
            <div className="relative z-10 flex flex-col items-center lg:items-start">
              <span className={`text-[10px] font-black uppercase tracking-[0.2em] mb-4 opacity-50`}>Live Power Inflow</span>
              <div className="flex items-baseline gap-2 mb-8 md:mb-12">
                <span className="text-7xl md:text-8xl font-black gradient-text mono tabular-nums tracking-tighter">
                  {metrics.watts > 0 ? metrics.watts.toFixed(1) : '0.0'}
                </span>
                <span className="text-2xl font-black opacity-20 italic">W</span>
              </div>
              <div className="grid grid-cols-2 gap-3 w-full max-w-md lg:max-w-none">
                <div className={`rounded-2xl p-4 md:p-5 border flex items-center gap-3 ${theme === 'dark' ? 'bg-slate-800/40 border-slate-700/30' : 'bg-slate-50 border-slate-100'}`}>
                  <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/15"><VoltageIcon className="w-5 h-5 text-amber-500" /></div>
                  <div>
                    <p className="text-[8px] font-black uppercase opacity-40">Potential</p>
                    <p className="text-xl font-black mono">{metrics.volts.toFixed(1)}V</p>
                  </div>
                </div>
                <div className={`rounded-2xl p-4 md:p-5 border flex items-center gap-3 ${theme === 'dark' ? 'bg-slate-800/40 border-slate-700/30' : 'bg-slate-50 border-slate-100'}`}>
                  <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/15"><AmpsIcon className="w-5 h-5 text-cyan-500" /></div>
                  <div>
                    <p className="text-[8px] font-black uppercase opacity-40">Intensity</p>
                    <p className="text-xl font-black mono">{metrics.amps.toFixed(2)}A</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={`rounded-[2rem] p-6 md:p-10 border transition-all relative overflow-hidden ${theme === 'dark' ? 'bg-slate-900 border-slate-800 shadow-2xl' : 'bg-white border-slate-200 shadow-lg'}`}>
            <div className="relative z-10">
              <span className={`text-[9px] font-black uppercase tracking-[0.3em] block mb-8 opacity-40`}>Battery Capacity</span>
              <div className="flex items-baseline justify-between mb-4">
                <div className="flex items-baseline">
                  <span className="text-5xl md:text-6xl font-black mono leading-none">{(level * 100).toFixed(0)}</span>
                  <span className="text-xl font-black opacity-20 ml-2 italic">%</span>
                </div>
                <BatteryIcon className="w-8 h-8 text-sky-500" />
              </div>
              <div className={`w-full h-10 rounded-2xl p-1 border relative overflow-hidden mb-8 ${theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'}`}>
                <div className="h-full bg-gradient-to-r from-sky-600 to-indigo-600 rounded-xl transition-all duration-1000 ease-out" style={{ width: `${level * 100}%` }}>
                  <div className="w-full h-full absolute top-0 left-0 bg-[linear-gradient(45deg,rgba(255,255,255,0.1)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.1)_50%,rgba(255,255,255,0.1)_75%,transparent_75%,transparent)] bg-[length:20px_20px] animate-[slide_1s_linear_infinite]" />
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <span className="text-[9px] font-black opacity-50">Active Charge</span>
                  <span className="text-base font-black mono">{currentMah} mAh</span>
                </div>
                <div className={`w-full h-[3px] rounded-full overflow-hidden ${theme === 'dark' ? 'bg-slate-800' : 'bg-slate-100'}`}>
                  <div className="h-full bg-sky-500 opacity-30 transition-all duration-1000" style={{ width: `${level * 100}%` }} />
                </div>
              </div>
            </div>
          </div>
        </main>

        <section className={`rounded-[2rem] p-6 md:p-8 border transition-all ${theme === 'dark' ? 'bg-slate-900 border-slate-800 shadow-2xl' : 'bg-white border-slate-200 shadow-lg'}`}>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10 px-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500"><ChartIcon className="w-5 h-5" /></div>
              <div><h2 className="text-lg font-black tracking-tight uppercase italic leading-none">Telemetry Graph</h2></div>
            </div>
            <div className="flex gap-4 text-[8px] font-black uppercase opacity-60">
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-sky-500" /> WATT</div>
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-500" /> VOLT</div>
            </div>
          </div>
          <div className="h-64 sm:h-80 w-full overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={formattedChartData}>
                <defs><linearGradient id="colorWatt" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.25}/><stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="8 8" vertical={false} stroke={theme === 'dark' ? '#1e293b' : '#f1f5f9'} />
                <XAxis dataKey="time" hide />
                <YAxis hide />
                <Tooltip contentStyle={{ backgroundColor: theme === 'dark' ? '#1e293b' : '#ffffff', borderColor: theme === 'dark' ? '#334155' : '#e2e8f0', borderRadius: '16px', fontSize: '10px' }} />
                <Area type="monotone" dataKey="wattage" stroke="#0ea5e9" strokeWidth={3} fillOpacity={1} fill="url(#colorWatt)" />
                <Line type="monotone" dataKey="voltage" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="6 6" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="w-full space-y-6">
          {(isCharging || (session && session.endTime)) ? (
            <div className={`rounded-[2rem] p-6 md:p-10 border transition-all space-y-8 shadow-xl ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
              <div className="flex justify-between items-center px-1">
                <div className="flex items-center gap-3">
                   <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500"><BoltIcon className="w-5 h-5" /></div>
                   <h3 className="text-lg font-black tracking-tight uppercase italic leading-none">{isCharging ? 'Active Diagnostic' : 'Diagnostic Summary'}</h3>
                </div>
                {isCharging && <div className="text-[10px] font-black uppercase text-sky-500 animate-pulse">Monitoring...</div>}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
                {[
                  { label: 'AVG RATE', val: (session?.avgWattage || metrics.watts).toFixed(1) + 'W' },
                  { label: 'POTENTIAL', val: (session?.avgVoltage || metrics.volts).toFixed(1) + 'V' },
                  { label: 'PEAK AMPS', val: (session?.maxAmperage || metrics.amps).toFixed(2) + 'A' },
                  { label: 'NET GAIN', val: '+' + (((session?.endLevel || level) - (session?.startLevel || level)) * 100).toFixed(0) + '%', accent: true }
                ].map((stat, i) => (
                  <div key={i} className={`p-4 rounded-2xl border ${theme === 'dark' ? 'bg-slate-800/40 border-slate-700/30' : 'bg-slate-50 border-slate-100'}`}>
                    <p className="text-[7px] font-black uppercase opacity-40 mb-1">{stat.label}</p>
                    <p className={`text-lg font-black mono ${stat.accent ? 'text-emerald-500' : ''}`}>{stat.val}</p>
                  </div>
                ))}
              </div>

              {!isCharging && (
                <div className={`rounded-2xl p-6 border ${theme === 'dark' ? 'bg-indigo-500/5 border-indigo-500/20' : 'bg-indigo-500/[0.02] border-indigo-500/10'}`}>
                  <div className="flex items-center gap-2 mb-4 text-indigo-500">
                    <div className="w-1.5 h-1.5 rounded-full bg-current" />
                    <span className="text-[9px] font-black uppercase">AI Health Analysis</span>
                  </div>
                  {isLoadingInsight ? (
                    <div className="flex items-center gap-3 font-black text-[10px] opacity-30"><div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /> Analyzing...</div>
                  ) : (
                    <p className="text-sm font-bold opacity-80 italic leading-snug">{aiInsight || "Recording stable baseline data..."}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
             <div className={`text-center py-16 px-6 border-2 border-dashed rounded-[2.5rem] ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
               <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 bg-slate-800 text-slate-100 shadow-sm"><BatteryIcon className="w-8 h-8" /></div>
               <h3 className="text-base font-black uppercase italic tracking-tight mb-2 opacity-80">System Standby</h3>
               <p className="text-[11px] font-medium opacity-40 max-w-xs mx-auto leading-relaxed">Connect hardware to initiate real-time telemetry.</p>
             </div>
          )}

          {/* History Log */}
          {pastSessions.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40 px-1">Session History</h4>
              <div className="space-y-2">
                {pastSessions.map((s, i) => (
                  <div key={i} className={`p-4 rounded-2xl border flex justify-between items-center ${theme === 'dark' ? 'bg-slate-900/60 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-sky-500/10 text-sky-500"><BoltIcon className="w-4 h-4" /></div>
                      <div>
                        <p className="text-[10px] font-black mono">{new Date(s.startTime).toLocaleDateString()} {new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        <p className="text-[8px] opacity-40 uppercase">Efficiency Analysis: {s.avgWattage.toFixed(1)}W AVG</p>
                      </div>
                    </div>
                    <span className="text-sm font-black text-emerald-500">+{( ( (s.endLevel || 0) - s.startLevel ) * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <footer className={`w-full flex justify-between items-center py-8 border-t mt-8 opacity-25 text-[8px] font-black uppercase ${theme === 'dark' ? 'border-slate-800' : 'border-slate-200'}`}>
          <p>© 2024 VOLTFLOW LABS</p>
          <span>CORE STABLE 2.7.0</span>
        </footer>
      </div>

      <style>{`
        @keyframes slide { from { background-position: 0 0; } to { background-position: 40px 0; } }
        .gradient-text { background: linear-gradient(to bottom right, #0ea5e9, #6366f1); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .dark .gradient-text { background: linear-gradient(to bottom right, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        html, body { height: 100%; position: fixed; width: 100%; overflow: hidden; }
        #root { height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; }
      `}</style>
    </div>
  );
};

export default App;
