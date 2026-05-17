import type { ThemeStyles } from './themeTypes';

export const THEME_IDS = {
  GLASS: 'glass',
  VINTAGE: 'vintage',
  CYBER: 'cyber',
  NORDIC: 'nordic',
  FROST: 'frost',
  NEUMORPH: 'neumorph',
} as const;

export type ThemeId = (typeof THEME_IDS)[keyof typeof THEME_IDS];

export const themes: Record<ThemeId, ThemeStyles> = {
  glass: {
    id: 'glass',
    label: 'Deep Glass',
    wrapper: 'bg-slate-900 text-slate-100 font-sans',
    bgEffect:
      'absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(14,165,233,0.15),transparent_60%)] pointer-events-none',
    panel:
      'bg-slate-800/40 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl',
    textPrimary: 'text-cyan-50',
    textSecondary: 'text-cyan-200/60',
    accent: 'text-cyan-400',
    accentBg: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50',
    buttonPrimary:
      'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white rounded-full shadow-[0_0_15px_rgba(6,182,212,0.4)]',
    buttonSecondary:
      'bg-slate-700/50 hover:bg-slate-600/50 text-cyan-200 border border-white/10 rounded-lg',
    mapBg:
      'bg-slate-900/80 border border-white/5 rounded-2xl overflow-hidden relative',
    routeColor: '#06b6d4',
    chartLineColor: '#0ea5e9',
    fontFamily: 'font-sans',
    input:
      'bg-slate-800/60 border border-white/10 text-cyan-50 placeholder-cyan-200/30 rounded-lg focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30',
    divider: 'border-white/10',
    cardHover: 'hover:bg-slate-700/30 hover:border-white/20',
    skeleton: 'bg-slate-700/40 animate-pulse rounded-lg',
    badge: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 rounded-full text-xs px-2 py-0.5',
    progressTrack: 'bg-slate-700/50 rounded-full',
    progressFill: 'bg-blue-500 rounded-full',
    scrollThumb: 'bg-white/10',
  },
  vintage: {
    id: 'vintage',
    label: 'Vintage',
    wrapper: 'bg-[#Ece5d3] text-[#3e3222] font-serif',
    bgEffect:
      'absolute inset-0 bg-[url("data:image/svg+xml,%3Csvg width=\'100\' height=\'100\' viewBox=\'0 0 100 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.8\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100\' height=\'100\' filter=\'url(%23noise)\' opacity=\'0.05\'/%3E%3C/svg%3E")] pointer-events-none opacity-50',
    panel:
      'bg-[#F4eedc]/90 border-2 border-[#8b7355]/30 shadow-[4px_4px_0px_rgba(139,115,85,0.2)] rounded-sm',
    textPrimary: 'text-[#2c2416]',
    textSecondary: 'text-[#6b5a45]',
    accent: 'text-[#9b2226]',
    accentBg: 'bg-[#8b7355]/10 text-[#6b5a45] border border-[#8b7355]/40',
    buttonPrimary:
      'bg-[#8b7355] hover:bg-[#6b5a45] text-[#F4eedc] rounded-sm uppercase tracking-widest text-xs font-bold border-2 border-[#3e3222]',
    buttonSecondary:
      'bg-[#F4eedc] hover:bg-[#e3d8c1] text-[#6b5a45] border-2 border-[#8b7355]/40 rounded-sm',
    mapBg:
      'bg-[#e3d8c1] border-2 border-[#8b7355]/50 rounded-sm overflow-hidden relative',
    routeColor: '#9b2226',
    chartLineColor: '#8b7355',
    fontFamily: 'font-serif',
    input:
      'bg-[#F4eedc] border-2 border-[#8b7355]/30 text-[#2c2416] placeholder-[#8b7355]/50 rounded-sm focus:border-[#9b2226] focus:ring-0',
    divider: 'border-[#8b7355]/20',
    cardHover: 'hover:bg-[#e3d8c1]/80 hover:border-[#8b7355]/50',
    skeleton: 'bg-[#d4c9b3] animate-pulse rounded-sm',
    badge: 'bg-[#8b7355]/10 text-[#6b5a45] border border-[#8b7355]/40 rounded-sm text-xs px-2 py-0.5 uppercase tracking-wider',
    progressTrack: 'bg-[#d4c9b3] rounded-sm',
    progressFill: 'bg-[#9b2226] rounded-sm',
    scrollThumb: 'bg-[#8b7355]/30',
  },
  cyber: {
    id: 'cyber',
    label: 'Cyberpunk',
    wrapper: 'bg-black text-green-500 font-mono uppercase tracking-wider',
    bgEffect:
      'absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(0,255,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,0,0.03)_1px,transparent_1px)] bg-[size:40px_40px]',
    panel:
      'bg-black border border-green-500/50 shadow-[0_0_10px_rgba(34,197,94,0.1)] rounded-none relative overflow-hidden',
    textPrimary: 'text-green-400 drop-shadow-[0_0_5px_rgba(34,197,94,0.5)]',
    textSecondary: 'text-green-700',
    accent: 'text-pink-500',
    accentBg:
      'bg-green-900/40 text-green-400 border border-green-500 shadow-[inset_0_0_10px_rgba(34,197,94,0.2)]',
    buttonPrimary:
      'bg-green-500 hover:bg-green-400 text-black font-bold rounded-none shadow-[0_0_15px_rgba(34,197,94,0.6)] hover:shadow-[0_0_25px_rgba(34,197,94,0.8)] transition-all',
    buttonSecondary:
      'bg-black hover:bg-green-900/30 text-green-400 border border-green-500/50 rounded-none',
    mapBg:
      'bg-gray-900/80 border border-pink-500/50 rounded-none overflow-hidden relative shadow-[inset_0_0_20px_rgba(236,72,153,0.2)]',
    routeColor: '#ec4899',
    chartLineColor: '#22c55e',
    fontFamily: 'font-mono',
    input:
      'bg-black border border-green-500/50 text-green-400 placeholder-green-700 rounded-none focus:border-green-400 focus:ring-0 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)]',
    divider: 'border-green-500/30',
    cardHover: 'hover:bg-green-900/20 hover:border-green-400',
    skeleton: 'bg-green-900/30 animate-pulse rounded-none',
    badge: 'bg-green-900/40 text-green-400 border border-green-500 rounded-none text-xs px-2 py-0.5',
    progressTrack: 'bg-green-900/30 rounded-none',
    progressFill: 'bg-pink-500 rounded-none',
    scrollThumb: 'bg-green-500/30',
  },
  nordic: {
    id: 'nordic',
    label: 'Nordic',
    wrapper: 'bg-stone-100 text-stone-800 font-sans',
    bgEffect: '',
    panel:
      'bg-white border border-stone-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-3xl',
    textPrimary: 'text-stone-800',
    textSecondary: 'text-stone-400',
    accent: 'text-sky-500',
    accentBg:
      'bg-stone-100 text-stone-600 border border-stone-200 rounded-2xl',
    buttonPrimary:
      'bg-stone-800 hover:bg-stone-700 text-white rounded-2xl shadow-md transition-transform hover:-translate-y-0.5',
    buttonSecondary:
      'bg-white hover:bg-stone-50 text-stone-600 border border-stone-200 rounded-2xl',
    mapBg:
      'bg-stone-200/50 border border-stone-200/50 rounded-3xl overflow-hidden relative',
    routeColor: '#0ea5e9',
    chartLineColor: '#a8a29e',
    fontFamily: 'font-sans',
    input:
      'bg-white border border-stone-200 text-stone-800 placeholder-stone-400 rounded-2xl focus:border-sky-400 focus:ring-1 focus:ring-sky-200',
    divider: 'border-stone-200',
    cardHover: 'hover:bg-stone-50 hover:shadow-md',
    skeleton: 'bg-stone-200 animate-pulse rounded-2xl',
    badge: 'bg-stone-100 text-stone-500 border border-stone-200 rounded-full text-xs px-2 py-0.5',
    progressTrack: 'bg-stone-200 rounded-full',
    progressFill: 'bg-sky-500 rounded-full',
    scrollThumb: 'bg-stone-300',
  },
  frost: {
    id: 'frost',
    label: 'Frost',
    wrapper: 'bg-fuchsia-50 text-slate-800 font-sans',
    bgEffect:
      'absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(167,139,250,0.3),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(244,114,182,0.3),transparent_50%),radial-gradient(circle_at_80%_20%,rgba(96,165,250,0.3),transparent_50%)] pointer-events-none',
    panel:
      'bg-white/40 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_rgba(0,0,0,0.05)] rounded-3xl',
    textPrimary: 'text-slate-900',
    textSecondary: 'text-slate-500',
    accent: 'text-indigo-600',
    accentBg:
      'bg-white/50 text-indigo-700 border border-white/70 shadow-sm rounded-2xl',
    buttonPrimary:
      'bg-white/60 backdrop-blur-md border border-white/80 hover:bg-white/80 text-indigo-700 rounded-full shadow-[0_4px_15px_rgba(0,0,0,0.05)] transition-all',
    buttonSecondary:
      'bg-white/30 hover:bg-white/50 text-slate-600 border border-white/60 rounded-full',
    mapBg:
      'bg-white/30 border border-white/50 rounded-3xl overflow-hidden relative backdrop-blur-md',
    routeColor: '#4f46e5',
    chartLineColor: '#818cf8',
    fontFamily: 'font-sans',
    input:
      'bg-white/50 border border-white/70 text-slate-800 placeholder-slate-400 rounded-2xl focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 backdrop-blur-sm',
    divider: 'border-white/40',
    cardHover: 'hover:bg-white/60 hover:shadow-lg',
    skeleton: 'bg-white/40 animate-pulse rounded-2xl',
    badge: 'bg-white/50 text-indigo-600 border border-white/60 rounded-full text-xs px-2 py-0.5',
    progressTrack: 'bg-white/40 rounded-full',
    progressFill: 'bg-indigo-500 rounded-full',
    scrollThumb: 'bg-white/50',
  },
  neumorph: {
    id: 'neumorph',
    label: 'Neumorph',
    wrapper: 'bg-[#e0e5ec] text-[#4a5568] font-sans',
    bgEffect: '',
    panel:
      'bg-[#e0e5ec] shadow-[9px_9px_16px_rgb(163,177,198,0.6),-9px_-9px_16px_rgba(255,255,255,0.5)] rounded-2xl',
    textPrimary: 'text-[#2d3748]',
    textSecondary: 'text-[#718096]',
    accent: 'text-[#e53e3e]',
    accentBg:
      'bg-[#e0e5ec] text-[#e53e3e] shadow-[inset_4px_4px_8px_rgb(163,177,198,0.6),inset_-4px_-4px_8px_rgba(255,255,255,0.5)] rounded-xl',
    buttonPrimary:
      'bg-[#e0e5ec] text-[#e53e3e] shadow-[6px_6px_10px_rgb(163,177,198,0.6),-6px_-6px_10px_rgba(255,255,255,0.5)] hover:shadow-[inset_4px_4px_8px_rgb(163,177,198,0.6),inset_-4px_-4px_8px_rgba(255,255,255,0.5)] rounded-full transition-all duration-200',
    buttonSecondary:
      'bg-[#e0e5ec] text-[#718096] shadow-[4px_4px_8px_rgb(163,177,198,0.6),-4px_-4px_8px_rgba(255,255,255,0.5)] hover:shadow-[inset_3px_3px_6px_rgb(163,177,198,0.6),inset_-3px_-3px_6px_rgba(255,255,255,0.5)] rounded-xl transition-all duration-200',
    mapBg:
      'bg-[#e0e5ec] shadow-[inset_6px_6px_12px_rgb(163,177,198,0.6),inset_-6px_-6px_12px_rgba(255,255,255,0.5)] rounded-2xl overflow-hidden relative',
    routeColor: '#e53e3e',
    chartLineColor: '#a0aec0',
    fontFamily: 'font-sans',
    input:
      'bg-[#e0e5ec] shadow-[inset_3px_3px_6px_rgb(163,177,198,0.6),inset_-3px_-3px_6px_rgba(255,255,255,0.5)] text-[#2d3748] placeholder-[#a0aec0] rounded-xl border-0 focus:ring-2 focus:ring-[#e53e3e]/30',
    divider: 'border-[#c8cfd8]',
    cardHover:
      'hover:shadow-[12px_12px_20px_rgb(163,177,198,0.6),-12px_-12px_20px_rgba(255,255,255,0.5)]',
    skeleton:
      'bg-[#e0e5ec] shadow-[inset_3px_3px_6px_rgb(163,177,198,0.3),inset_-3px_-3px_6px_rgba(255,255,255,0.3)] animate-pulse rounded-xl',
    badge:
      'bg-[#e0e5ec] text-[#e53e3e] shadow-[inset_2px_2px_4px_rgb(163,177,198,0.6),inset_-2px_-2px_4px_rgba(255,255,255,0.5)] rounded-xl text-xs px-2 py-0.5',
    progressTrack:
      'bg-[#e0e5ec] shadow-[inset_2px_2px_5px_rgb(163,177,198,0.6),inset_-2px_-2px_5px_rgba(255,255,255,0.5)] rounded-full',
    progressFill: 'bg-[#e53e3e] rounded-full',
    scrollThumb:
      'bg-[#d0d5dc] shadow-[2px_2px_4px_rgb(163,177,198,0.4),-2px_-2px_4px_rgba(255,255,255,0.3)]',
  },
};
