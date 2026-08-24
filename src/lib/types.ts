export type SignalAction = 'BUY' | 'SELL' | 'CLOSE';

export type SignalChange = {
  revision: number;
  field: string;
  label: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
};

export type Signal = {
  id: number;
  externalSignalId: string | null;
  strategyName: string | null;
  symbol: string | null;
  market: string | null;
  action: SignalAction | null;
  price: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  takeProfits: number[];
  timeframe: string | null;
  status: 'OPEN' | 'CLOSED';
  result: string | null;
  closePrice: number | null;
  closedAt: string | null;
  pnlPercent: number | null;
  note: string | null;
  isSample: boolean;
  editedAt: string | null;
  editCount: number;
  signalTimestamp: string;
  receivedAt: string;
  locked: boolean;
  changes?: SignalChange[];
};

export type SignalPage = {
  items: Signal[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  isPro: boolean;
};

export type AppUser = {
  id: number;
  email: string;
  plan: 'FREE' | 'PRO';
  subscriptionStatus: string;
  proStartAt: string | null;
  proEndAt: string | null;
  proRemainingMs: number;
  suspended: boolean;
  timezone: string | null;
  createdAt: string;
  lastSeenAt: string | null;
};

export type AppConfig = {
  telegramUrl: string;
  websiteUrl: string;
  instagramUrl: string;
  supportEmail: string;
  freePushPerDay: number;
  freeVisibleCount: number;
  historyDays: number;
  stats: { total: number; wins: number; losses: number; winRate: number };
};

export type NotificationPreferences = {
  notificationsEnabled: boolean;
  tradingSignalsEnabled: boolean;
  buySignalsEnabled: boolean;
  sellSignalsEnabled: boolean;
};

export type PendingNotification = {
  jobId: number;
  type: 'TRADING_SIGNAL';
  kind: 'NEW' | 'UPDATE';
  revision: number;
  signalId: number;
  title: string;
  body: string;
};

export type AdminUser = AppUser;

export type DeliveryLog = {
  id: number;
  signal_id: number;
  device_id: number;
  user_id: number | null;
  status: string;
  reason: string | null;
  attempts: number;
  kind: string | null;
  revision: number | null;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  symbol: string | null;
  action: string | null;
};

export type WebhookEvent = {
  id: number;
  external_signal_id: string | null;
  outcome: string;
  message: string | null;
  created_at: string;
};
