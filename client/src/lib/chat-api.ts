import { getStoredPlanId } from "./utils";
/**
 * Funciones de acceso a la API para el chat.
 * @module chat-api
 */

/**
 * Get the current block number from the backend.
 * @returns Promise resolving to the current block number.
 */
export async function getCurrentBlockNumber(): Promise<number> {
  const response = await fetch("/api/latest-block", {
    method: "GET",
    headers: {
      ...(getStoredPlanId() ? { "X-Plan-Id": String(getStoredPlanId()) } : {}),
    },
  });
  if (!response.ok) throw new Error("Failed to get current block number");
  const data = await response.json();
  return data.blockNumber;
}

/**
 * Send a message to the agent via backend proxy and return the response.
 * @param content The user message to send.
 * @returns Promise resolving to the agent response.
 */
export async function sendMessageToAgent(content: string): Promise<{
  response: string;
  sessionId?: string;
  creditsRedeemed?: number;
  remainingBalance?: number;
  txHash?: string;
}> {
  const apiKey = localStorage.getItem("nvmApiKey");
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ input_query: content }),
  });
  if (!response.ok) throw new Error("Failed to send message to the agent");
  const data = await response.json();
  return {
    response: data.output,
    sessionId: data.sessionId,
    creditsRedeemed: data.payment?.creditsRedeemed
      ? parseInt(data.payment.creditsRedeemed, 10)
      : undefined,
    remainingBalance: data.payment?.remainingBalance
      ? parseInt(data.payment.remainingBalance, 10)
      : undefined,
    txHash: data.settlement?.txHash,
  };
}

/**
 * Retrieve the task for a given task ID.
 * @param task_id The task ID to retrieve the task for.
 * @returns Promise resolving to the task.
 */
export async function getTask(task_id: string): Promise<any> {
  const apiKey = localStorage.getItem("nvmApiKey");
  const response = await fetch(`/api/task?task_id=${task_id}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });

  if (!response.ok) throw new Error("Failed to retrieve task");
  const data = await response.json();
  return data;
}

/**
 * Retrieves the burn transaction for a given block number.
 * @param blockNumber The block number to start searching from.
 * @returns Promise resolving to burn transaction data (or null if not found).
 */
export async function getBurnTransaction(
  blockNumber: number
): Promise<any | null> {
  const apiKey = localStorage.getItem("nvmApiKey");
  const planId = getStoredPlanId() || "";
  const burnTxResp = await fetch(`/api/find-burn-tx?fromBlock=${blockNumber}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(planId ? { "X-Plan-Id": planId } : {}),
    },
  });
  if (!burnTxResp.ok) return null;
  return await burnTxResp.json();
}

/**
 * Updates the credits and gets the burn transaction for a given task ID.
 * @param taskId The task ID to update the credits for.
 * @returns Promise resolving to burn transaction data (or null if not found).
 */
export async function updateCreditsAndGetBurnTx(
  taskId: string
): Promise<any | null> {
  const blockNumber = await getCurrentBlockNumber();
  await getTask(taskId);
  const burnTxResp = await getBurnTransaction(blockNumber);
  if (!burnTxResp) return null;
  return burnTxResp;
}
