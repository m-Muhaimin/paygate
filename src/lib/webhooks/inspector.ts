import { db } from "@/lib/db/client";
import { attemptDelivery } from "./dispatch";
import { internal } from "@/lib/api/errors";

export async function listDeliveries(merchantId: string, limit = 50) {
  const supabase = db();
  const { data, error } = await supabase
    .from("webhook_deliveries")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw internal("list_deliveries_failed", error);
  return data;
}

export async function manualResend(deliveryId: string): Promise<void> {
  await attemptDelivery(deliveryId);
}
