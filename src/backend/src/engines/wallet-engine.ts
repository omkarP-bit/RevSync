import { PoolClient } from "pg";
import { query } from "../database/pool.js";

export interface WalletRecord {
  id: number;
  customer_id: number;
  balance: number;
  currency: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreditTransactionRecord {
  id: number;
  wallet_id: number;
  type: "CANCELLATION_CREDIT" | "INVOICE_OFFSET" | "MANUAL_ADJUSTMENT" | "REFUND";
  amount: number;
  reference_type?: string;
  reference_id?: number;
  description: string;
  created_at: Date;
}

/**
 * Retrieves existing customer credit wallet or initializes one with zero balance.
 */
export async function getOrCreateWallet(
  client: PoolClient | null,
  customerId: number,
  currencyCode = "USD"
): Promise<WalletRecord> {
  const runner = client ?? { query };
  const existing = await runner.query(
    `SELECT id, customer_id, balance, currency, created_at, updated_at
     FROM customer_credit_wallets
     WHERE customer_id = $1`,
    [customerId]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return {
      id: Number(row.id),
      customer_id: Number(row.customer_id),
      balance: Number(row.balance),
      currency: row.currency,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  const insert = await runner.query(
    `INSERT INTO customer_credit_wallets (customer_id, balance, currency)
     VALUES ($1, 0, $2)
     RETURNING id, customer_id, balance, currency, created_at, updated_at`,
    [customerId, currencyCode]
  );
  const row = insert.rows[0];
  return {
    id: Number(row.id),
    customer_id: Number(row.customer_id),
    balance: Number(row.balance),
    currency: row.currency,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Credits a customer wallet with new credit (e.g. from subscription cancellation or negative proration).
 */
export async function addCreditToWallet(
  client: PoolClient,
  params: {
    customerId: number;
    amount: number;
    currencyCode?: string;
    type: "CANCELLATION_CREDIT" | "INVOICE_OFFSET" | "MANUAL_ADJUSTMENT" | "REFUND";
    referenceType?: string;
    referenceId?: number;
    description: string;
  }
): Promise<{ wallet: WalletRecord; transactionId: number }> {
  if (params.amount <= 0) {
    throw new Error("Credit amount must be positive");
  }

  const wallet = await getOrCreateWallet(client, params.customerId, params.currencyCode || "USD");

  const updatedWalletRes = await client.query(
    `UPDATE customer_credit_wallets
     SET balance = balance + $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, customer_id, balance, currency, created_at, updated_at`,
    [params.amount, wallet.id]
  );
  const updatedWalletRow = updatedWalletRes.rows[0];

  const txRes = await client.query(
    `INSERT INTO credit_transactions (wallet_id, type, amount, reference_type, reference_id, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      wallet.id,
      params.type,
      params.amount,
      params.referenceType || null,
      params.referenceId || null,
      params.description,
    ]
  );

  return {
    wallet: {
      id: Number(updatedWalletRow.id),
      customer_id: Number(updatedWalletRow.customer_id),
      balance: Number(updatedWalletRow.balance),
      currency: updatedWalletRow.currency,
      created_at: updatedWalletRow.created_at,
      updated_at: updatedWalletRow.updated_at,
    },
    transactionId: Number(txRes.rows[0].id),
  };
}

/**
 * Applies available customer wallet balance to reduce an invoice amount due.
 * Returns the actual wallet offset amount applied.
 */
export async function applyWalletToInvoice(
  client: PoolClient,
  params: {
    customerId: number;
    invoiceAmount: number;
    invoiceId: number;
    currencyCode?: string;
  }
): Promise<number> {
  if (params.invoiceAmount <= 0) return 0;

  const wallet = await getOrCreateWallet(client, params.customerId, params.currencyCode || "USD");
  if (wallet.balance <= 0) return 0;

  const offset = Number(Math.min(params.invoiceAmount, wallet.balance).toFixed(4));
  if (offset <= 0) return 0;

  await client.query(
    `UPDATE customer_credit_wallets
     SET balance = balance - $1, updated_at = NOW()
     WHERE id = $2 AND balance >= $1`,
    [offset, wallet.id]
  );

  await client.query(
    `INSERT INTO credit_transactions (wallet_id, type, amount, reference_type, reference_id, description)
     VALUES ($1, 'INVOICE_OFFSET', $2, 'INVOICE', $3, $4)`,
    [wallet.id, -offset, params.invoiceId, `Applied to Invoice ID ${params.invoiceId}`]
  );

  return offset;
}
