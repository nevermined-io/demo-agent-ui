import { Payments, EnvironmentName } from "@nevermined-io/payments";
import { PlanDDOHelper } from "./planDDOHelper";
import {
  hasSufficientERC20Balance,
  findMintEvent,
  getCurrentBlockNumber,
  findBurnEvent,
} from "./blockchainService";

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
  const environment = process.env.NVM_ENVIRONMENT || "testing";
  if (!nvmApiKey || !planId) {
    throw new Error("Missing Nevermined API key or plan DID");
  }
  const payments = initializePayments(nvmApiKey, environment);
  const balanceResult = await payments.plans.getPlanBalance(planId);
  const credit = parseInt(balanceResult.balance.toString());
  return credit;
}

/**
 * Gets the agent access token for making direct HTTP requests to the agent.
 * @param {string} nvmApiKey - Nevermined API key
 * @returns {Promise<{accessToken: string, agentId: string}>} - The access token and agent ID
 */
export async function getAgentAccessToken(
  nvmApiKey: string,
  planId: string
): Promise<{
  accessToken: string;
  agentId: string;
}> {
  const environment = process.env.NVM_ENVIRONMENT || "testing";
  const agentDid = process.env.AGENT_DID;

  if (!nvmApiKey || !planId || !agentDid) {
    throw new Error("Missing config: nvmApiKey, planId, or agentDid");
  }

  const payments = initializePayments(nvmApiKey, environment);
  const agentAccessParams = await payments.agents.getAgentAccessToken(
    planId,
    agentDid
  );

  return {
    accessToken: agentAccessParams.accessToken,
    agentId: agentDid,
  };
}

/**
 * Calls the agent with the synthesized intent and returns the agent response payload.
 * @param {string} inputQuery - Synthesized intent to send to the agent
 * @param {string} nvmApiKey - Nevermined API key
 * @returns {Promise<any>} - The agent response
 */
export async function createTask(
  inputQuery: string,
  nvmApiKey: string,
  planId: string
): Promise<any> {
  const agentEndpoint = process.env.AGENT_ENDPOINT;
  if (!agentEndpoint) {
    throw new Error("Missing AGENT_ENDPOINT environment variable");
  }

  const { accessToken } = await getAgentAccessToken(nvmApiKey, planId);

  const response = await fetch(agentEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      input_query: inputQuery,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Agent request failed: ${response.status} ${response.statusText}`
    );
  }

  const result = await response.json();
  // Return the full agent response as-is; downstream will interpret fields
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
  const environment = process.env.NVM_ENVIRONMENT || "testing";
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
 * Gets task details by making a direct HTTP request to the agent.
 * @param {string} task_id - Task ID
 * @param {string} nvmApiKey - Nevermined API key
 * @returns {Promise<any>} - Task details
 */
export async function getTask(
  task_id: string,
  nvmApiKey: string,
  planId: string
): Promise<any> {
  const agentEndpoint = process.env.AGENT_ENDPOINT;
  if (!agentEndpoint) {
    throw new Error("Missing AGENT_ENDPOINT environment variable");
  }

  const { accessToken } = await getAgentAccessToken(nvmApiKey, planId);

  // Construct the task endpoint URL
  const taskEndpoint = `${agentEndpoint}/${task_id}`;

  const response = await fetch(taskEndpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Agent request failed: ${response.status} ${response.statusText}`
    );
  }

  return await response.json();
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
  const environment = process.env.NVM_ENVIRONMENT || "testing";
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
  const environment = process.env.NVM_ENVIRONMENT || "testing";
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
