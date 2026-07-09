import { z } from "zod";

export const transferRequestSchema = z.object({
  sourceWalletId: z.string().uuid(),
  destinationWalletId: z.string().uuid(),
  amount: z.number().positive().finite().max(10_000_000),
  idempotencyKey: z.string().min(8).max(128).optional(),
  narrative: z.string().max(280).optional(),
});

export type TransferRequestInput = z.infer<typeof transferRequestSchema>;

export const orangeMoneyWebhookSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.enum(["payment.succeeded", "payment.failed", "payment.pending"]),
  transaction_id: z.string().uuid(),
  carrier_reference: z.string().min(1),
  msisdn: z.string().min(6),
  amount: z.number().positive(),
  currency: z.literal("BWP"),
  status: z.enum(["SUCCESSFUL", "FAILED", "PENDING"]),
  failure_reason: z.string().optional(),
  timestamp: z.string().datetime(),
});

export type OrangeMoneyWebhookPayload = z.infer<typeof orangeMoneyWebhookSchema>;
