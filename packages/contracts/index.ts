export type Profile = { id: string; nickname: string; avatar: number; avatarVersion: string | null };
export type Friend = Profile & { relationshipId: string };
export type Me = Profile & { friendCode: string; friend: Friend | null };

export type Book = {
  id: string;
  title: string;
  totalPages: number;
  revision: number;
  currentPage: number;
  completedOn: string | null;
};

export type ProgressBook = Book & {
  weekOpeningPage: number;
  beforeToday: number;
  days: { date: string; page: number }[];
};

export type Home = {
  serverNow: string;
  timeZone: 'Asia/Shanghai';
  date: string;
  weekStart: string;
  relationshipId: string | null;
  self: Profile & { books: ProgressBook[] };
  friend: (Profile & { books: ProgressBook[] }) | null;
};

export type CheckInInput = { page: number; expectedRevision: number; expectedDate: string; requestId: string };
export type CheckInResult = { record: { id: string; page: number; date: string }; book: Book };

export const firstStatisticsYear = 2026;
export type DailyTotal = { date: string; pages: number };
export type BookHistory = Book & { checkIns: { date: string; page: number }[] };
export type Statistics = {
  reading: Book[];
  completed: BookHistory[];
  dailyTotals: DailyTotal[];
};
