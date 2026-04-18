export type OrderStatus =
  | "pending"
  | "fulfilled"
  | "expired"
  | "refunded";

export type FlowStep = {
  step: number;
  label: string;
  description: string;
  completed: boolean;
  timestamp?: string;
};

export type Order = {
  id: string;
  orderId: string;
  product: string;
  buyer: string;
  observer: string;
  lockedEth: string;
  encAmountHandle?: string;
  encProductHandle?: string;
  encAesKeyHandle?: string;
  ipfsCid?: string;
  deadline: string;
  createdAt: string;
  status: OrderStatus;
  txHash?: string;
  flowSteps: FlowStep[];
};

export type DashboardStats = {
  totalOrders: number;
  totalVolume: string;
  pendingCount: number;
  fulfilledCount: number;
};
