import {
  Payments,
  EnvironmentName,
  decodeAccessToken,
  type X402PaymentRequired,
} from "@nevermined-io/payments";
import { PlanDDOHelper } from "./planDDOHelper";
import {
  hasSufficientERC20Balance,
  findMintEvent,
  getCurrentBlockNumber,
  findBurnEvent,
} from "./blockchainService";

/**
 * Cache for x402 access tokens, keyed by "planId:agentId"
 */
const x402TokenCache = new Map<string, string>();

/**
 * Initializes the Nevermined Payments library.
 * @param {string} nvmApiKey - Nevermined API key
 * @param {string} environment - testing, staging or production
 * @returns {Payments} - Authenticated Payments instance
 */
export function initializePayments(
  nvmApiKey: string,
  environment: string
): Payments {
  const payments = Payments.getInstance({
    nvmApiKey,
    environment: environment as EnvironmentName,
  });
  if (!payments.isLoggedIn) {
    throw new Error("Failed to log in to the Nevermined Payments Library");
  }
  return payments;
}

/**
 * Gets the available credits for a plan.
 * @param {string} nvmApiKey - Nevermined API key
 * @param {string} environment - testing, staging or production
 * @param {string} planId - The plan DID
 * @returns {Promise<number>} - The available credits
 */
export async function getUserCredits(
  nvmApiKey: string,
  planId: string
): Promise<number> {
  const environment = process.env.NVM_ENVIRONMENT || "staging_sandbox";
  if (!nvmApiKey || !planId) {
    throw new Error("Missing Nevermined API key or plan DID");
  }
  const payments = initializePayments(nvmApiKey, environment);
  const balanceResult = await payments.plans.getPlanBalance(planId);
  const credit = parseInt(balanceResult.balance.toString());
  return credit;
}

/**
 * Extracts planId and agentId from X402PaymentRequired.
 * @param {X402PaymentRequired} paymentRequired - The decoded payment requirements from PAYMENT-REQUIRED header
 * @returns {{ planId: string; agentId: string }} planId and agentId
 * @throws {Error} If payment requirements are invalid or missing required fields
 */
function extractPaymentScheme(paymentRequired: X402PaymentRequired): {
  planId: string;
  agentId: string;
} {
  const scheme = paymentRequired.accepts?.[0];
  if (!scheme) {
    throw new Error("No payment scheme found in payment requirements");
  }

  const planId = scheme.planId;
  const agentId = scheme.extra?.agentId;

  if (!planId || !agentId) {
    throw new Error("Missing planId or agentId in payment requirements");
  }

  return { planId, agentId };
}

/**
 * Parses and decodes the PAYMENT-REQUIRED header from a 402 response.
 * @param {Response} response - The HTTP response containing the 402 status
 * @returns {X402PaymentRequired | null} Decoded payment requirements or null if header is missing/invalid
 */
function parsePaymentRequiredHeader(
  response: Response
): X402PaymentRequired | null {
  const header = response.headers.get("payment-required");
  if (!header) {
    console.log("[x402] No PAYMENT-REQUIRED header found in 402 response");
    return null;
  }

  try {
    const paymentRequired = decodeAccessToken(header) as X402PaymentRequired;
    console.log("[x402] Received payment requirements:");
    console.log(`   Plan ID: ${paymentRequired.accepts?.[0]?.planId}`);
    console.log(`   Agent ID: ${paymentRequired.accepts?.[0]?.extra?.agentId}`);
    return paymentRequired;
  } catch (error) {
    console.error("[x402] Failed to parse PAYMENT-REQUIRED header:", error);
    return null;
  }
}

/**
 * Gets a cached x402 token or fetches a new one if not in cache.
 * @param {Payments} payments - Payments instance
 * @param {string} planId - The plan identifier
 * @param {string} agentId - The agent identifier
 * @returns {Promise<string>} The x402 access token
 */
async function getOrFetchX402Token(
  payments: Payments,
  planId: string,
  agentId: string
): Promise<string> {
  const cacheKey = `${planId}:${agentId}`;
  const cachedToken = x402TokenCache.get(cacheKey);

  if (cachedToken) {
    console.log("[x402] Using cached x402 access token");
    return cachedToken;
  }

  console.log("[x402] Obtaining x402 access token...");
  const result = await payments.x402.getX402AccessToken(planId, agentId);
  if (!result?.accessToken) {
    throw new Error("Failed to obtain x402 access token");
  }

  console.log("[x402] x402 access token obtained successfully");
  x402TokenCache.set(cacheKey, result.accessToken);
  return result.accessToken;
}

/**
 * Clears the x402 token cache for a specific plan/agent combination.
 * @param {string} planId - The plan identifier
 * @param {string} agentId - The agent identifier
 */
function clearX402TokenCache(planId: string, agentId: string): void {
  const cacheKey = `${planId}:${agentId}`;
  x402TokenCache.delete(cacheKey);
}

/**
 * Calls the agent with the synthesized intent using the x402 payment flow.
 * Implements the full x402 protocol:
 * 1. Makes initial request without payment token
 * 2. Receives 402 Payment Required with PAYMENT-REQUIRED header
 * 3. Obtains x402 access token based on payment requirements (planId/agentId from header)
 * 4. Retries request with PAYMENT-SIGNATURE header
 * 5. Processes successful response with payment settlement
 *
 * @param {string} inputQuery - Synthesized intent to send to the agent
 * @param {string} nvmApiKey - Nevermined API key
 * @returns {Promise<any>} - The agent response
 */
export async function createTask(
  inputQuery: string,
  nvmApiKey: string
): Promise<any> {
  const agentEndpoint = process.env.AGENT_ENDPOINT;
  if (!agentEndpoint) {
    throw new Error("Missing AGENT_ENDPOINT environment variable");
  }

  const environment = process.env.NVM_ENVIRONMENT || "staging_sandbox";
  const payments = initializePayments(nvmApiKey, environment);

  // Step 1: Make initial request WITHOUT PAYMENT-SIGNATURE header
  console.log("[x402] Making initial request to agent (no payment token)...");
  const initialResponse = await fetch(agentEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input_query: inputQuery }),
  });

  // Step 2: If not 402, handle as normal response
  if (initialResponse.status !== 402) {
    if (!initialResponse.ok) {
      throw new Error(
        `Agent request failed: ${initialResponse.status} ${initialResponse.statusText}`
      );
    }
    // Agent is not x402 protected, return response directly
    return await initialResponse.json();
  }

  // Step 3: Handle 402 Payment Required - parse PAYMENT-REQUIRED header
  console.log("[x402] Received 402 Payment Required");
  const paymentRequired = parsePaymentRequiredHeader(initialResponse);
  if (!paymentRequired) {
    throw new Error("Invalid payment requirements in 402 response");
  }

  // Step 4: Extract planId and agentId from payment requirements
  const { planId, agentId } = extractPaymentScheme(paymentRequired);

  // Step 5: Get x402 access token (with caching)
  const x402Token = await getOrFetchX402Token(payments, planId, agentId);

  // Step 6: Retry request with PAYMENT-SIGNATURE header
  console.log("[x402] Retrying request with PAYMENT-SIGNATURE header...");
  const retryResponse = await fetch(agentEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "PAYMENT-SIGNATURE": x402Token,
    },
    body: JSON.stringify({ input_query: inputQuery }),
  });

  // Step 7: Handle retry response
  if (!retryResponse.ok) {
    // If still 402, token might be invalid - clear cache and throw
    if (retryResponse.status === 402) {
      clearX402TokenCache(planId, agentId);
      const errorBody = await retryResponse.text().catch(() => "");
      throw new Error(`Payment still required after retry: ${errorBody}`);
    }
    throw new Error(
      `Agent request failed after payment: ${retryResponse.status} ${retryResponse.statusText}`
    );
  }

  // Step 8: Parse PAYMENT-RESPONSE header if present
  let settlementInfo: {
    success?: boolean;
    txHash?: string;
  } | null = null;

  const paymentResponseHeader = retryResponse.headers.get("payment-response");
  if (paymentResponseHeader) {
    try {
      const paymentResponse = decodeAccessToken(paymentResponseHeader) as {
        success?: boolean;
        transaction?: string;
      };
      console.log(
        "[x402] Payment settled:",
        paymentResponse.success ? "Success" : "Failed"
      );
      if (paymentResponse.transaction) {
        console.log(
          `[x402] Transaction: ${paymentResponse.transaction.substring(
            0,
            20
          )}...`
        );
      }
      settlementInfo = {
        success: paymentResponse.success,
        txHash: paymentResponse.transaction,
      };
    } catch {
      // Silently ignore parsing errors for payment response header
    }
  }

  const result = await retryResponse.json();

  // Merge settlement info into response if available
  if (settlementInfo) {
    return {
      ...result,
      settlement: settlementInfo,
    };
  }

  return result;
}

/**
 * Orders credits for a plan, checks balance, and returns the mint transaction.
 * @param {string} planId - Plan DID
 * @param {string} nvmApiKey - Nevermined API key
 * @returns {Promise<{ success: boolean, txHash?: string, credits?: string, message: string }>}
 */
export async function orderPlanCredits(
  planId: string,
  nvmApiKey: string
): Promise<{
  success: boolean;
  txHash?: string;
  credits?: string;
  message: string;
}> {
  const environment = process.env.NVM_ENVIRONMENT;
  if (!nvmApiKey || !environment) {
    throw new Error("Missing Nevermined API key or environment");
  }
  const payments = initializePayments(nvmApiKey, environment);
  const planHelper = new PlanDDOHelper(payments, planId);
  await planHelper.loadDDO();

  // 1. Get plan price and token address
  const planPrice = await planHelper.getPlanPrice();
  const tokenAddress = await planHelper.getTokenAddress();
  if (!tokenAddress) {
    return { success: false, message: "Token address not found in plan DDO" };
  }

  // 2. Get our wallet address
  const ourWallet = payments.getAccountAddress() || "";
  if (!ourWallet) {
    return { success: false, message: "Wallet address not found" };
  }

  // 3. Check if we have enough USDC
  const hasBalance = await hasSufficientERC20Balance(
    tokenAddress,
    ourWallet,
    planPrice
  );
  if (!hasBalance) {
    return {
      success: false,
      message: "Insufficient USDC balance to purchase credits",
    };
  }

  // 4. Call orderPlan
  const fromBlock = await getCurrentBlockNumber();
  try {
    const orderResult = await payments.plans.orderPlan(planId);
    if (!orderResult.success) {
      return { success: false, message: "Failed to order credits for plan" };
    }
  } catch (error: any) {
    console.error("Error ordering plan credits:", error);
    return {
      success: false,
      message: error.message || "Failed to order credits for plan",
    };
  }

  // 5. Find mint event
  const contractAddress = await planHelper.get1155ContractAddress();
  const tokenId = await planHelper.getTokenId();
  const mintEvent = contractAddress
    ? await findMintEvent(contractAddress, ourWallet, tokenId, fromBlock)
    : null;

  // 6. Return result
  if (mintEvent) {
    return {
      success: true,
      txHash: mintEvent.txHash,
      credits: mintEvent.value,
      message: `Credits purchased and added to your balance. (tx: ${mintEvent.txHash})`,
    };
  }
  return {
    success: true,
    message: "Credits purchased and added to your balance.",
  };
}

/**
 * Gets the burn transaction info for the current plan and wallet from a given block.
 * @param {number} fromBlock - The block number to start searching from
 * @param {string} nvmApiKey - Nevermined API key
 * @returns {Promise<{ txHash: string, credits: string, planId: string } | null>}
 */
export async function getBurnTransactionInfo(
  fromBlock: number,
  nvmApiKey: string,
  planId: string
): Promise<{ txHash: string; credits: string; planId: string } | null> {
  const environment = process.env.NVM_ENVIRONMENT || "staging_sandbox";
  if (!nvmApiKey || !planId) {
    throw new Error("Missing config");
  }
  const payments = initializePayments(nvmApiKey, environment);
  const planHelper = new PlanDDOHelper(payments, planId);
  await planHelper.loadDDO();
  const contractAddress = await planHelper.get1155ContractAddress();
  const tokenId = await planHelper.getTokenId();
  const ourWallet = payments.getAccountAddress() || "";
  if (!contractAddress || !tokenId || !ourWallet) {
    throw new Error("Missing contract, tokenId or wallet");
  }
  let burnEvent = null;
  let attempts = 0;
  while (attempts < 10 && !burnEvent) {
    burnEvent = await findBurnEvent(
      contractAddress,
      ourWallet,
      tokenId,
      fromBlock
    );
    if (!burnEvent) {
      attempts++;
      if (attempts < 10) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
  if (burnEvent) {
    return {
      txHash: burnEvent.txHash,
      credits: burnEvent.value,
      planId: planId,
    };
  }
  return null;
}

/**
 * Gets task details by making a direct HTTP request to the agent using x402 flow.
 * planId and agentId are extracted from the 402 PAYMENT-REQUIRED header.
 * @param {string} task_id - Task ID
 * @param {string} nvmApiKey - Nevermined API key
 * @returns {Promise<any>} - Task details
 */
export async function getTask(
  task_id: string,
  nvmApiKey: string
): Promise<any> {
  const agentEndpoint = process.env.AGENT_ENDPOINT;
  if (!agentEndpoint) {
    throw new Error("Missing AGENT_ENDPOINT environment variable");
  }

  const environment = process.env.NVM_ENVIRONMENT || "staging_sandbox";
  const payments = initializePayments(nvmApiKey, environment);

  // Construct the task endpoint URL
  const taskEndpoint = `${agentEndpoint}/${task_id}`;

  // Step 1: Make initial request WITHOUT PAYMENT-SIGNATURE header
  const initialResponse = await fetch(taskEndpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  // Step 2: If not 402, handle as normal response
  if (initialResponse.status !== 402) {
    if (!initialResponse.ok) {
      throw new Error(
        `Agent request failed: ${initialResponse.status} ${initialResponse.statusText}`
      );
    }
    return await initialResponse.json();
  }

  // Step 3: Handle 402 Payment Required
  const paymentRequired = parsePaymentRequiredHeader(initialResponse);
  if (!paymentRequired) {
    throw new Error("Invalid payment requirements in 402 response");
  }

  const { planId, agentId } = extractPaymentScheme(paymentRequired);
  const x402Token = await getOrFetchX402Token(payments, planId, agentId);

  // Step 4: Retry with PAYMENT-SIGNATURE header
  const retryResponse = await fetch(taskEndpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "PAYMENT-SIGNATURE": x402Token,
    },
  });

  if (!retryResponse.ok) {
    if (retryResponse.status === 402) {
      clearX402TokenCache(planId, agentId);
      throw new Error("Payment still required after retry");
    }
    throw new Error(
      `Agent request failed: ${retryResponse.status} ${retryResponse.statusText}`
    );
  }

  return await retryResponse.json();
}

/**
 * Gets the plan price (in USDC units) and number of credits for a plan.
 * @param {string} nvmApiKey - Nevermined API key
 * @returns {Promise<{ planPrice: string, planCredits: number }>}
 */
export async function getPlanCost(
  nvmApiKey: string,
  planId: string
): Promise<{
  planPrice: string;
  planCredits: number;
}> {
  const environment = process.env.NVM_ENVIRONMENT || "staging_sandbox";
  if (!nvmApiKey || !planId) {
    throw new Error("Missing config");
  }
  const payments = initializePayments(nvmApiKey, environment);
  const planHelper = new PlanDDOHelper(payments, planId);
  await planHelper.loadDDO();
  const planPrice = await planHelper.getPlanPrice();
  const planCredits = await planHelper.getPlanCredits();
  return { planPrice, planCredits };
}

/**
 * Redeems a given amount of credits for the current plan and wallet.
 * @param {string} planId - Plan DID
 * @param {string} creditsAmount - Amount of credits to redeem (as string)
 * @param {string} nvmApiKey - Nevermined API key
 * @returns {Promise<{ success: boolean, txHash?: string, message: string }>}
 */
export async function redeemCredits(
  planId: string,
  creditsAmount: string,
  nvmApiKey: string
): Promise<{
  success: boolean;
  txHash?: string;
  message: string;
}> {
  const environment = process.env.NVM_ENVIRONMENT || "staging_sandbox";
  const agentId = process.env.AGENT_DID;
  if (!nvmApiKey || !planId || !agentId) {
    throw new Error("Missing Nevermined API key or plan DID");
  }
  const payments = initializePayments(nvmApiKey, environment);
  const redeemFrom = payments.getAccountAddress();

  if (!redeemFrom) {
    throw new Error("Wallet address not found");
  }

  try {
    const result = await payments.plans.redeemCredits(
      agentId,
      planId,
      redeemFrom as `0x${string}`,
      creditsAmount
    );
    if (result && result.success) {
      return {
        success: true,
        txHash: result.txHash,
        message: result.message || "Credits redeemed successfully.",
      };
    } else {
      return {
        success: false,
        message: result?.message || "Failed to redeem credits.",
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || "Error redeeming credits.",
    };
  }
}
