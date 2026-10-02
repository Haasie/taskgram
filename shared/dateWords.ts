export type DateWords = {
  today: string;
  tomorrow: string;
  yesterday: string;
  overdue: (days: number) => string;
  daysLeft: (days: number) => string;
};

export const dateWords: Record<'nl' | 'en', DateWords> = {
  nl: {
    today: 'Vandaag',
    tomorrow: 'Morgen',
    yesterday: 'Gisteren',
    overdue: (days: number) => `${days} ${days === 1 ? 'dag' : 'dagen'} te laat`,
    daysLeft: (days: number) => `nog ${days} dagen`
  },
  en: {
    today: 'Today',
    tomorrow: 'Tomorrow',
    yesterday: 'Yesterday',
    overdue: (days: number) => `${days} ${days === 1 ? 'day' : 'days'} overdue`,
    daysLeft: (days: number) => `${days} ${days === 1 ? 'day' : 'days'} left`
  }
};
