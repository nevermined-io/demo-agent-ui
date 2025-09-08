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
      ...(localStorage.getItem("nvmPlanId")
        ? { "X-Plan-Id": String(localStorage.getItem("nvmPlanId")) }
        : {}),
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
  txHash?: string;
  credits?: number;
}> {
  const apiKey = localStorage.getItem("nvmApiKey");
  const planId = localStorage.getItem("nvmPlanId") || "";
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(planId ? { "X-Plan-Id": planId } : {}),
    },
    body: JSON.stringify({ input_query: content }),
  });
  if (!response.ok) throw new Error("Failed to send message to the agent");
  const data = await response.json();
  return {
    response: data.output,
    txHash: data.redemptionResult.txHash,
    credits: data.redemptionResult.creditsRedeemed,
  };
}

/**
 * Retrieve the task for a given task ID.
 * @param task_id The task ID to retrieve the task for.
 * @returns Promise resolving to the task.
 */
export async function getTask(task_id: string): Promise<any> {
  const apiKey = localStorage.getItem("nvmApiKey");
  const planId = localStorage.getItem("nvmPlanId") || "";
  const response = await fetch(`/api/task?task_id=${task_id}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(planId ? { "X-Plan-Id": planId } : {}),
    },
  });

  if (!response.ok) throw new Error("Failed to retrieve credits burned");
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
  const planId = localStorage.getItem("nvmPlanId") || "";
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
