export type KycStatus = "unverified" | "pending" | "verified" | "rejected";

export type WalletCategory =
  | "mobile_money"
  | "bank"
  | "fx"
  | "trading"
  | "sportsbook"
  | "platform";

export type TransactionType =
  | "deposit"
  | "withdrawal"
  | "transfer"
  | "fx_swap"
  | "merchant_payment";

export type TransactionStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "reversed";

export type LedgerEntryDirection = "debit" | "credit";

export type WebhookProvider =
  | "orange_money"
  | "myzaka"
  | "smega"
  | "deriv"
  | "bet365";

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  is_active: boolean;
}

export interface Profile {
  id: string;
  full_name: string;
  phone_number: string | null;
  country_code: string;
  kyc_status: KycStatus;
  created_at: string;
  updated_at: string;
}

export interface Wallet {
  id: string;
  user_id: string;
  currency_code: string;
  category: WalletCategory;
  provider_name: string;
  display_name: string;
  balance: number;
  available_balance: number;
  is_active: boolean;
  is_default: boolean;
  external_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExternalAccount {
  id: string;
  user_id: string;
  provider: WebhookProvider;
  category: WalletCategory;
  account_label: string;
  masked_identifier: string;
  is_verified: boolean;
  created_at: string;
}

export interface FxRate {
  id: string;
  base_currency: string;
  quote_currency: string;
  mid_rate: number;
  spread_bps: number;
  updated_at: string;
}

export interface TransactionMetadata {
  carrier_id?: string;
  carrier_reference?: string;
  merchant_id?: string;
  merchant_account_id?: string;
  narrative?: string;
  device_fingerprint?: string;
  ip_address?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface Transaction {
  id: string;
  user_id: string;
  sender_wallet_id: string | null;
  receiver_wallet_id: string | null;
  type: TransactionType;
  status: TransactionStatus;
  source_amount: number;
  source_currency: string;
  destination_amount: number;
  destination_currency: string;
  fx_rate: number;
  fee_amount: number;
  idempotency_key: string | null;
  external_reference: string | null;
  failure_reason: string | null;
  metadata: TransactionMetadata;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface LedgerEntry {
  id: string;
  transaction_id: string;
  wallet_id: string;
  direction: LedgerEntryDirection;
  amount: number;
  currency_code: string;
  created_at: string;
}

export interface WebhookEvent {
  id: string;
  provider: WebhookProvider;
  event_id: string;
  transaction_id: string | null;
  signature_valid: boolean;
  payload: Record<string, unknown>;
  processed_at: string | null;
  created_at: string;
}

export interface ExecuteLedgerTransferArgs {
  p_user_id: string;
  p_sender_wallet_id: string;
  p_receiver_wallet_id: string;
  p_source_amount: number;
  p_type: TransactionType;
  p_fee_amount?: number;
  p_idempotency_key?: string | null;
  p_metadata?: TransactionMetadata;
}

export interface CreatePendingSettlementArgs {
  p_user_id: string;
  p_wallet_id: string;
  p_type: TransactionType;
  p_source_amount: number;
  p_destination_amount: number;
  p_source_currency: string;
  p_destination_currency: string;
  p_fx_rate?: number;
  p_fee_amount?: number;
  p_external_reference?: string | null;
  p_idempotency_key?: string | null;
  p_metadata?: TransactionMetadata;
}

export interface SettlePendingTransactionArgs {
  p_transaction_id: string;
  p_external_reference?: string | null;
}

export interface FailPendingTransactionArgs {
  p_transaction_id: string;
  p_reason?: string;
}

export interface ReserveWalletFundsArgs {
  p_wallet_id: string;
  p_amount: number;
}

export interface Database {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      currencies: {
        Row: Currency;
        Insert: Currency;
        Update: Partial<Currency>;
        Relationships: [];
      };
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, "created_at" | "updated_at"> &
          Partial<Pick<Profile, "created_at" | "updated_at">>;
        Update: Partial<Profile>;
        Relationships: [];
      };
      wallets: {
        Row: Wallet;
        Insert: Omit<Wallet, "id" | "created_at" | "updated_at"> &
          Partial<Pick<Wallet, "id" | "created_at" | "updated_at">>;
        Update: Partial<Wallet>;
        Relationships: [];
      };
      external_accounts: {
        Row: ExternalAccount;
        Insert: Omit<ExternalAccount, "id" | "created_at"> &
          Partial<Pick<ExternalAccount, "id" | "created_at">>;
        Update: Partial<ExternalAccount>;
        Relationships: [];
      };
      fx_rates: {
        Row: FxRate;
        Insert: Omit<FxRate, "id" | "updated_at"> &
          Partial<Pick<FxRate, "id" | "updated_at">>;
        Update: Partial<FxRate>;
        Relationships: [];
      };
      transactions: {
        Row: Transaction;
        Insert: Omit<Transaction, "id" | "created_at" | "updated_at"> &
          Partial<Pick<Transaction, "id" | "created_at" | "updated_at">>;
        Update: Partial<Transaction>;
        Relationships: [];
      };
      ledger_entries: {
        Row: LedgerEntry;
        Insert: Omit<LedgerEntry, "id" | "created_at"> &
          Partial<Pick<LedgerEntry, "id" | "created_at">>;
        Update: Partial<LedgerEntry>;
        Relationships: [];
      };
      webhook_events: {
        Row: WebhookEvent;
        Insert: Omit<WebhookEvent, "id" | "created_at"> &
          Partial<Pick<WebhookEvent, "id" | "created_at">>;
        Update: Partial<WebhookEvent>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      execute_ledger_transfer: {
        Args: ExecuteLedgerTransferArgs;
        Returns: Transaction;
      };
      create_pending_settlement: {
        Args: CreatePendingSettlementArgs;
        Returns: Transaction;
      };
      settle_pending_transaction: {
        Args: SettlePendingTransactionArgs;
        Returns: Transaction;
      };
      fail_pending_transaction: {
        Args: FailPendingTransactionArgs;
        Returns: Transaction;
      };
      reserve_wallet_funds: {
        Args: ReserveWalletFundsArgs;
        Returns: Wallet;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
