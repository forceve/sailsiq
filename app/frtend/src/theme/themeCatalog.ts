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
    colorScheme: 'dark',
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
    colorScheme: 'light',
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
    colorScheme: 'dark',
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
    colorScheme: 'light',
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
    colorScheme: 'light',
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
    colorScheme: 'light',
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

export type ThemeColorScheme = ThemeStyles['colorScheme'];
export type ThemeColorMode = ThemeColorScheme | 'browser';

function withScheme(
  base: ThemeStyles,
  colorScheme: ThemeColorScheme,
  overrides: Partial<ThemeStyles>,
): ThemeStyles {
  return {
    ...base,
    ...overrides,
    id: base.id,
    label: base.label,
    colorScheme,
  };
}

export const themeVariants: Record<ThemeId, Record<ThemeColorScheme, ThemeStyles>> = {
  glass: {
    dark: themes.glass,
    light: withScheme(themes.glass, 'light', {
      wrapper: 'bg-sky-50 text-slate-900 font-sans',
      bgEffect:
        'absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(14,165,233,0.22),transparent_55%)] pointer-events-none',
      panel: 'bg-white/70 backdrop-blur-xl border border-sky-100 shadow-xl rounded-2xl',
      textPrimary: 'text-slate-950',
      textSecondary: 'text-slate-500',
      accent: 'text-cyan-700',
      accentBg: 'bg-cyan-100 text-cyan-800 border border-cyan-200',
      buttonPrimary:
        'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-full shadow-[0_10px_24px_rgba(14,165,233,0.22)]',
      buttonSecondary:
        'bg-white/80 hover:bg-cyan-50 text-slate-700 border border-sky-100 rounded-lg',
      mapBg: 'bg-sky-100/70 border border-sky-100 rounded-2xl overflow-hidden relative',
      routeColor: '#0891b2',
      chartLineColor: '#0284c7',
      input:
        'bg-white/80 border border-sky-100 text-slate-900 placeholder-slate-400 rounded-lg focus:border-cyan-400 focus:ring-1 focus:ring-cyan-200',
      divider: 'border-sky-100',
      cardHover: 'hover:bg-cyan-50/70 hover:border-cyan-200',
      skeleton: 'bg-sky-100 animate-pulse rounded-lg',
      badge: 'bg-cyan-100 text-cyan-800 border border-cyan-200 rounded-full text-xs px-2 py-0.5',
      progressTrack: 'bg-sky-100 rounded-full',
      progressFill: 'bg-cyan-600 rounded-full',
      scrollThumb: 'bg-cyan-200',
    }),
  },
  vintage: {
    light: themes.vintage,
    dark: withScheme(themes.vintage, 'dark', {
      wrapper: 'bg-[#1f1a13] text-[#f4eedc] font-serif',
      bgEffect:
        'absolute inset-0 bg-[url("data:image/svg+xml,%3Csvg width=\'100\' height=\'100\' viewBox=\'0 0 100 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.8\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100\' height=\'100\' filter=\'url(%23noise)\' opacity=\'0.08\'/%3E%3C/svg%3E")] pointer-events-none opacity-60',
      panel:
        'bg-[#2b2419]/95 border-2 border-[#b79b6b]/30 shadow-[4px_4px_0px_rgba(0,0,0,0.35)] rounded-sm',
      textPrimary: 'text-[#f8f1df]',
      textSecondary: 'text-[#b9a686]',
      accent: 'text-[#f87171]',
      accentBg: 'bg-[#b79b6b]/15 text-[#f4d9a0] border border-[#b79b6b]/40',
      buttonPrimary:
        'bg-[#b79b6b] hover:bg-[#d2b277] text-[#1f1a13] rounded-sm uppercase tracking-widest text-xs font-bold border-2 border-[#f4eedc]/70',
      buttonSecondary:
        'bg-[#2b2419] hover:bg-[#3a3022] text-[#f4d9a0] border-2 border-[#b79b6b]/40 rounded-sm',
      mapBg: 'bg-[#17130e] border-2 border-[#b79b6b]/40 rounded-sm overflow-hidden relative',
      routeColor: '#f87171',
      chartLineColor: '#d2b277',
      input:
        'bg-[#241e15] border-2 border-[#b79b6b]/30 text-[#f8f1df] placeholder-[#b9a686]/60 rounded-sm focus:border-[#f87171] focus:ring-0',
      divider: 'border-[#b79b6b]/25',
      cardHover: 'hover:bg-[#3a3022]/80 hover:border-[#b79b6b]/50',
      skeleton: 'bg-[#3a3022] animate-pulse rounded-sm',
      badge:
        'bg-[#b79b6b]/15 text-[#f4d9a0] border border-[#b79b6b]/40 rounded-sm text-xs px-2 py-0.5 uppercase tracking-wider',
      progressTrack: 'bg-[#3a3022] rounded-sm',
      progressFill: 'bg-[#f87171] rounded-sm',
      scrollThumb: 'bg-[#b79b6b]/35',
    }),
  },
  cyber: {
    dark: themes.cyber,
    light: withScheme(themes.cyber, 'light', {
      wrapper: 'bg-zinc-50 text-zinc-950 font-mono uppercase tracking-wider',
      bgEffect:
        'absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(34,197,94,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(236,72,153,0.07)_1px,transparent_1px)] bg-[size:40px_40px]',
      panel:
        'bg-white border border-green-500/35 shadow-[0_0_12px_rgba(34,197,94,0.12)] rounded-none relative overflow-hidden',
      textPrimary: 'text-zinc-950',
      textSecondary: 'text-green-700',
      accent: 'text-pink-600',
      accentBg:
        'bg-green-100 text-green-800 border border-green-500 shadow-[inset_0_0_10px_rgba(34,197,94,0.12)]',
      buttonPrimary:
        'bg-green-500 hover:bg-green-400 text-black font-bold rounded-none shadow-[0_0_15px_rgba(34,197,94,0.35)] transition-all',
      buttonSecondary:
        'bg-white hover:bg-green-50 text-green-800 border border-green-500/50 rounded-none',
      mapBg:
        'bg-zinc-100 border border-pink-500/40 rounded-none overflow-hidden relative shadow-[inset_0_0_18px_rgba(236,72,153,0.12)]',
      routeColor: '#db2777',
      chartLineColor: '#16a34a',
      input:
        'bg-white border border-green-500/50 text-zinc-950 placeholder-green-700/60 rounded-none focus:border-green-500 focus:ring-0 focus:shadow-[0_0_10px_rgba(34,197,94,0.18)]',
      divider: 'border-green-500/25',
      cardHover: 'hover:bg-green-50 hover:border-green-500',
      skeleton: 'bg-green-100 animate-pulse rounded-none',
      badge: 'bg-green-100 text-green-800 border border-green-500 rounded-none text-xs px-2 py-0.5',
      progressTrack: 'bg-green-100 rounded-none',
      progressFill: 'bg-pink-600 rounded-none',
      scrollThumb: 'bg-green-500/25',
    }),
  },
  nordic: {
    light: themes.nordic,
    dark: withScheme(themes.nordic, 'dark', {
      wrapper: 'bg-stone-950 text-stone-100 font-sans',
      bgEffect: '',
      panel: 'bg-stone-900 border border-stone-800 shadow-[0_8px_30px_rgb(0,0,0,0.25)] rounded-3xl',
      textPrimary: 'text-stone-100',
      textSecondary: 'text-stone-400',
      accent: 'text-sky-400',
      accentBg: 'bg-stone-800 text-stone-100 border border-stone-700 rounded-2xl',
      buttonPrimary:
        'bg-stone-100 hover:bg-white text-stone-950 rounded-2xl shadow-md transition-transform hover:-translate-y-0.5',
      buttonSecondary:
        'bg-stone-900 hover:bg-stone-800 text-stone-200 border border-stone-700 rounded-2xl',
      mapBg: 'bg-stone-900 border border-stone-800 rounded-3xl overflow-hidden relative',
      routeColor: '#38bdf8',
      chartLineColor: '#a8a29e',
      input:
        'bg-stone-900 border border-stone-700 text-stone-100 placeholder-stone-500 rounded-2xl focus:border-sky-400 focus:ring-1 focus:ring-sky-500/30',
      divider: 'border-stone-800',
      cardHover: 'hover:bg-stone-800 hover:shadow-md',
      skeleton: 'bg-stone-800 animate-pulse rounded-2xl',
      badge: 'bg-stone-800 text-stone-200 border border-stone-700 rounded-full text-xs px-2 py-0.5',
      progressTrack: 'bg-stone-800 rounded-full',
      progressFill: 'bg-sky-400 rounded-full',
      scrollThumb: 'bg-stone-700',
    }),
  },
  frost: {
    light: themes.frost,
    dark: withScheme(themes.frost, 'dark', {
      wrapper: 'bg-slate-950 text-slate-100 font-sans',
      bgEffect:
        'absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(129,140,248,0.2),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(244,114,182,0.18),transparent_50%),radial-gradient(circle_at_80%_20%,rgba(14,165,233,0.16),transparent_50%)] pointer-events-none',
      panel:
        'bg-slate-900/55 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.28)] rounded-3xl',
      textPrimary: 'text-slate-50',
      textSecondary: 'text-slate-400',
      accent: 'text-indigo-300',
      accentBg: 'bg-white/10 text-indigo-200 border border-white/15 shadow-sm rounded-2xl',
      buttonPrimary:
        'bg-white/15 backdrop-blur-md border border-white/20 hover:bg-white/25 text-indigo-100 rounded-full shadow-[0_4px_15px_rgba(0,0,0,0.18)] transition-all',
      buttonSecondary:
        'bg-white/10 hover:bg-white/15 text-slate-200 border border-white/15 rounded-full',
      mapBg:
        'bg-slate-900/50 border border-white/10 rounded-3xl overflow-hidden relative backdrop-blur-md',
      routeColor: '#a5b4fc',
      chartLineColor: '#818cf8',
      input:
        'bg-white/10 border border-white/15 text-slate-100 placeholder-slate-500 rounded-2xl focus:border-indigo-300 focus:ring-1 focus:ring-indigo-400/30 backdrop-blur-sm',
      divider: 'border-white/10',
      cardHover: 'hover:bg-white/10 hover:shadow-lg',
      skeleton: 'bg-white/10 animate-pulse rounded-2xl',
      badge: 'bg-white/10 text-indigo-200 border border-white/15 rounded-full text-xs px-2 py-0.5',
      progressTrack: 'bg-white/10 rounded-full',
      progressFill: 'bg-indigo-300 rounded-full',
      scrollThumb: 'bg-white/20',
    }),
  },
  neumorph: {
    light: themes.neumorph,
    dark: withScheme(themes.neumorph, 'dark', {
      wrapper: 'bg-[#20242b] text-[#d7dde7] font-sans',
      bgEffect: '',
      panel:
        'bg-[#20242b] shadow-[9px_9px_16px_rgba(0,0,0,0.45),-9px_-9px_16px_rgba(255,255,255,0.04)] rounded-2xl',
      textPrimary: 'text-[#f1f5f9]',
      textSecondary: 'text-[#94a3b8]',
      accent: 'text-[#f87171]',
      accentBg:
        'bg-[#20242b] text-[#f87171] shadow-[inset_4px_4px_8px_rgba(0,0,0,0.45),inset_-4px_-4px_8px_rgba(255,255,255,0.04)] rounded-xl',
      buttonPrimary:
        'bg-[#20242b] text-[#f87171] shadow-[6px_6px_10px_rgba(0,0,0,0.45),-6px_-6px_10px_rgba(255,255,255,0.04)] hover:shadow-[inset_4px_4px_8px_rgba(0,0,0,0.45),inset_-4px_-4px_8px_rgba(255,255,255,0.04)] rounded-full transition-all duration-200',
      buttonSecondary:
        'bg-[#20242b] text-[#cbd5e1] shadow-[4px_4px_8px_rgba(0,0,0,0.45),-4px_-4px_8px_rgba(255,255,255,0.04)] hover:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.45),inset_-3px_-3px_6px_rgba(255,255,255,0.04)] rounded-xl transition-all duration-200',
      mapBg:
        'bg-[#20242b] shadow-[inset_6px_6px_12px_rgba(0,0,0,0.45),inset_-6px_-6px_12px_rgba(255,255,255,0.04)] rounded-2xl overflow-hidden relative',
      routeColor: '#f87171',
      chartLineColor: '#94a3b8',
      input:
        'bg-[#20242b] shadow-[inset_3px_3px_6px_rgba(0,0,0,0.45),inset_-3px_-3px_6px_rgba(255,255,255,0.04)] text-[#f1f5f9] placeholder-[#64748b] rounded-xl border-0 focus:ring-2 focus:ring-[#f87171]/30',
      divider: 'border-[#343a45]',
      cardHover:
        'hover:shadow-[12px_12px_20px_rgba(0,0,0,0.45),-12px_-12px_20px_rgba(255,255,255,0.04)]',
      skeleton:
        'bg-[#20242b] shadow-[inset_3px_3px_6px_rgba(0,0,0,0.35),inset_-3px_-3px_6px_rgba(255,255,255,0.03)] animate-pulse rounded-xl',
      badge:
        'bg-[#20242b] text-[#f87171] shadow-[inset_2px_2px_4px_rgba(0,0,0,0.45),inset_-2px_-2px_4px_rgba(255,255,255,0.04)] rounded-xl text-xs px-2 py-0.5',
      progressTrack:
        'bg-[#20242b] shadow-[inset_2px_2px_5px_rgba(0,0,0,0.45),inset_-2px_-2px_5px_rgba(255,255,255,0.04)] rounded-full',
      progressFill: 'bg-[#f87171] rounded-full',
      scrollThumb:
        'bg-[#343a45] shadow-[2px_2px_4px_rgba(0,0,0,0.35),-2px_-2px_4px_rgba(255,255,255,0.03)]',
    }),
  },
};
