/**
 * API request helpers for chat-context.
 * All functions wrap fetch calls for chat-related endpoints.
 * @module chat-requests
 */

/**
 * Calls the LLM router endpoint to determine the next action.
 * @param {string} content - The user message.
 * @param {any[]} history - The chat history.
 * @returns {Promise<{action: "forward" | "no_credit" | "order_plan" | "no_action", message?: string, reason?: string}>}
 */
export async function llmRouterRequest(
  content: string,
  history: any[]
): Promise<{
  action: "forward" | "no_credit" | "order_plan" | "no_action";
  message?: string;
  reason?: string;
}> {
  const apiKey = localStorage.getItem("nvmApiKey");
  const resp = await fetch("/api/llm-router", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(localStorage.getItem("nvmPlanId")
        ? { "X-Plan-Id": String(localStorage.getItem("nvmPlanId")) }
        : {}),
    },
    body: JSON.stringify({
      message: content,
      history,
    }),
  });
  if (!resp.ok) throw new Error("llm-router request failed");
  return await resp.json();
}

/**
 * Calls the order plan endpoint to order a payment plan.
 * @returns {Promise<any>} The response data.
 */
export async function orderPlanRequest(): Promise<any> {
  const apiKey = localStorage.getItem("nvmApiKey");
  const resp = await fetch("/api/order-plan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(localStorage.getItem("nvmPlanId")
        ? { "X-Plan-Id": String(localStorage.getItem("nvmPlanId")) }
        : {}),
    },
  });
  if (!resp.ok) throw new Error("order-plan request failed");
  return await resp.json();
}

/**
 * Calls the title summarizer endpoint to get a conversation title.
 * @param {any[]} history - The chat history.
 * @returns {Promise<any>} The response data.
 */
export async function titleSummarizeRequest(history: any[]): Promise<any> {
  const resp = await fetch("/api/title/summarize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(localStorage.getItem("nvmPlanId")
        ? { "X-Plan-Id": String(localStorage.getItem("nvmPlanId")) }
        : {}),
    },
    body: JSON.stringify({ history }),
  });
  if (!resp.ok) throw new Error("title-summarize request failed");
  return await resp.json();
}

/**
 * Calls the intent synthesizer endpoint to get the user's intent.
 * @param {any[]} history - The chat history.
 * @returns {Promise<any>} The response data.
 */
export async function intentSynthesizeRequest(history: any[]): Promise<any> {
  const resp = await fetch("/api/intent/synthesize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(localStorage.getItem("nvmPlanId")
        ? { "X-Plan-Id": String(localStorage.getItem("nvmPlanId")) }
        : {}),
    },
    body: JSON.stringify({ history }),
  });
  if (!resp.ok) throw new Error("intent-synthesize request failed");
  return await resp.json();
}

/**
 * Calls the plan cost endpoint to get the plan price (in USDC) and number of credits.
 * @returns {Promise<{ planPrice: string, planCredits: number }>} The response data.
 */
export async function getPlanCostRequest(): Promise<{
  planPrice: string;
  planCredits: number;
}> {
  const apiKey = localStorage.getItem("nvmApiKey");
  const resp = await fetch(`/api/plan/cost`, {
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(localStorage.getItem("nvmPlanId")
        ? { "X-Plan-Id": String(localStorage.getItem("nvmPlanId")) }
        : {}),
    },
  });
  if (!resp.ok) throw new Error("plan-cost request failed");
  return await resp.json();
}
