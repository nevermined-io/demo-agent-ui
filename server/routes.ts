import type { Express } from "express";
import { createServer, type Server } from "http";
import { llmRouter, llmTitleSummarizer } from "./services/llmService";
import {
  getUserCredits,
  createTask,
  orderPlanCredits,
  getBurnTransactionInfo,
  getTask,
  getPlanCost,
  redeemCredits,
} from "./services/paymentsService";
import { llmIntentSynthesizer } from "./services/llmService";
import { getCurrentBlockNumber } from "./services/blockchainService";
import { loadAgentPrompt } from "./services/promptService";

/**
 * POST /api/title/summarize
 * Synthesizes the user's input into a title using OpenAI, using the conversation history
 * @param {Array<{role: string, content: string}>} history - The conversation history
 * @returns {string} title - The synthesized title
 */
export async function registerRoutes(app: Express): Promise<Server> {
  app.post("/api/title/summarize", async (req, res) => {
    try {
      const { history } = req.body;

      if (!Array.isArray(history)) {
        return res.status(400).json({ error: "Missing or invalid history" });
      }

      const title = await llmTitleSummarizer(history);
      res.json({ title });
    } catch (err) {
      res.status(500).json({ error: "Failed to generate title" });
    }
  });

  /**
   * GET /api/credit
   * Returns the credit available for the user
   * Requires Authorization header with Bearer token
   * @returns {number} credit - The credit available
   */
  app.get("/api/credit", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res
          .status(401)
          .json({ error: "Missing or invalid Authorization header" });
      }
      const nvmApiKey = authHeader.replace("Bearer ", "").trim();
      if (!nvmApiKey) {
        return res.status(401).json({ error: "Missing API Key" });
      }
      const planId =
        (req.headers["x-plan-id"] as string) || process.env.PLAN_ID || "";
      if (!planId) {
        return res.status(500).json({ error: "Missing plan DID" });
      }
      const credit = await getUserCredits(nvmApiKey, planId);
      res.json({ credit });
    } catch (err) {
      console.error("Error fetching credit:", err);
      res.status(500).json({ error: "Failed to fetch credit" });
    }
  });

  /**
   * POST /api/llm-router
   * Decides what to do with the user's message before sending it to the agent using OpenAI and the user's real credits.
   * @body {string} message - The user's message
   * @body {FullMessage[]} history - The conversation history
   * @returns { action: "forward" | "no_credit" | "order_plan" | "no_action", message?: string }
   */
  app.post("/api/llm-router", async (req, res) => {
    const { message, history } = req.body;
    if (typeof message !== "string") {
      return res.status(400).json({ error: "Missing message" });
    }
    try {
      // Authorization optional: if missing, assume 0 credits so router can still work
      const authHeader = req.headers.authorization;
      let credits = 0;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const nvmApiKey = authHeader.replace("Bearer ", "").trim();
        if (nvmApiKey) {
          try {
            const planId =
              (req.headers["x-plan-id"] as string) || process.env.PLAN_ID || "";
            if (planId) {
              credits = await getUserCredits(nvmApiKey, planId);
            } else {
              credits = 0;
            }
          } catch (e) {
            credits = 0;
          }
        }
      }
      const result = await llmRouter(message, history, credits);
      return res.json(result);
    } catch (err) {
      return res
        .status(500)
        .json({ error: "Failed to call LLM or get credits" });
    }
  });

  /**
   * POST /api/order-plan
   * Simulates the purchase of a Nevermined plan and returns a success message.
   * Requires Authorization header with Bearer token
   * @returns {string} message - Confirmation message
   */
  app.post("/api/order-plan", async (req, res) => {
    const planId =
      (req.headers["x-plan-id"] as string) || process.env.PLAN_ID || "";
    if (!planId) {
      return res.status(500).json({ error: "Missing plan DID" });
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid Authorization header" });
    }
    const nvmApiKey = authHeader.replace("Bearer ", "").trim();
    if (!nvmApiKey) {
      return res.status(401).json({ error: "Missing API Key" });
    }
    const result = await orderPlanCredits(planId, nvmApiKey);
    if (result.success) {
      res.json({
        message:
          result.message ||
          "Plan purchased successfully. You now have credits!",
        txHash: result.txHash,
        credits: result.credits,
        planId,
      });
    } else {
      res.status(402).json({ error: result.message });
    }
  });

  /**
   * POST /api/intent/synthesize
   * Synthesizes the user's intent from the conversation history using OpenAI
   * Requires Authorization header with Bearer token
   * @body {Array<{role: string, content: string}>} history - The conversation history
   * @returns {string} intent - The synthesized intent
   */
  app.post("/api/intent/synthesize", async (req, res) => {
    try {
      const { history } = req.body;
      if (!Array.isArray(history)) {
        return res.status(400).json({ error: "Missing or invalid history" });
      }

      const agentPrompt = loadAgentPrompt();
      const intent = await llmIntentSynthesizer(history, agentPrompt);
      res.json({ intent });
    } catch (err) {
      res.status(500).json({ error: "Failed to synthesize intent" });
    }
  });

  /**
   * POST /api/agent
   * Sends the synthesized intent to the agent and returns the agent response.
   * Requires Authorization header with Bearer token
   * @body {string} input_query - Synthesized intent
   * @returns {object} - Agent response payload from the agent
   */
  app.post("/api/agent", async (req, res) => {
    const { input_query: inputQuery } = req.body;
    if (typeof inputQuery !== "string") {
      return res.status(400).json({ error: "Missing input_query" });
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid Authorization header" });
    }
    const nvmApiKey = authHeader.replace("Bearer ", "").trim();
    if (!nvmApiKey) {
      return res.status(401).json({ error: "Missing API Key" });
    }
    const planId =
      (req.headers["x-plan-id"] as string) || process.env.PLAN_ID || "";
    if (!planId) {
      return res.status(500).json({ error: "Missing plan DID" });
    }
    try {
      const agentResponse = await createTask(inputQuery, nvmApiKey, planId);
      return res.status(200).json(agentResponse);
    } catch (error) {
      console.error("Error creating task:", error);
      return res.status(500).json({ error: "Failed to call agent" });
    }
  });

  /**
   * GET /api/latest-block
   * Returns the latest block number from the blockchain
   * @returns {number} blockNumber - The latest block number
   */
  app.get("/api/latest-block", async (req, res) => {
    try {
      const blockNumber = await getCurrentBlockNumber();
      res.json({ blockNumber });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch latest block" });
    }
  });
  /**
   * GET /api/find-burn-tx
   * Finds the burn transaction for the current plan and wallet from a given block
   * Requires Authorization header with Bearer token
   * @query {number} fromBlock - The block number to start searching from
   * @query {string} [taskId] - (Optional) The task identifier
   * @returns {object} - { txHash, value, message }
   */
  app.get("/api/find-burn-tx", async (req, res) => {
    const { fromBlock } = req.query;
    if (!fromBlock) {
      return res.status(400).json({ error: "Missing fromBlock parameter" });
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid Authorization header" });
    }
    const nvmApiKey = authHeader.replace("Bearer ", "").trim();
    if (!nvmApiKey) {
      return res.status(401).json({ error: "Missing API Key" });
    }
    const planId =
      (req.headers["x-plan-id"] as string) || process.env.PLAN_ID || "";
    if (!planId) {
      return res.status(500).json({ error: "Missing plan DID" });
    }
    try {
      const result = await getBurnTransactionInfo(
        Number(fromBlock),
        nvmApiKey,
        planId
      );
      if (result && result.txHash) {
        res.json(result);
      } else {
        res.status(404).json({ message: "No burn transaction found" });
      }
    } catch (err) {
      res.status(500).json({ error: "Failed to search for burn transaction" });
    }
  });

  /**
   * GET /api/task
   * Returns the task details for a given task_id
   * Requires Authorization header with Bearer token
   */
  app.get("/api/task", async (req, res) => {
    const { task_id } = req.query;
    if (!task_id) {
      return res.status(400).json({ error: "Missing task_id" });
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid Authorization header" });
    }
    const nvmApiKey = authHeader.replace("Bearer ", "").trim();
    if (!nvmApiKey) {
      return res.status(401).json({ error: "Missing API Key" });
    }
    const planId =
      (req.headers["x-plan-id"] as string) || process.env.PLAN_ID || "";
    if (!planId) {
      return res.status(500).json({ error: "Missing plan DID" });
    }
    const task = await getTask(task_id as string, nvmApiKey, planId);
    res.json(task);
  });

  /**
   * GET /api/plan/cost
   * Calculates the cost in USDC for a given number of credits of a plan.
   * Requires Authorization header with Bearer token
   * @query {string} planId - The plan DID
   * @query {number} credits - The number of credits consumed
   * @returns {object} - { cost: string, planPrice: string, planCredits: number, credits: number }
   */
  app.get("/api/plan/cost", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid Authorization header" });
    }
    const nvmApiKey = authHeader.replace("Bearer ", "").trim();
    if (!nvmApiKey) {
      return res.status(401).json({ error: "Missing API Key" });
    }
    try {
      const planId =
        (req.headers["x-plan-id"] as string) || process.env.PLAN_ID || "";
      if (!planId) {
        return res.status(500).json({ error: "Missing plan DID" });
      }
      const result = await getPlanCost(nvmApiKey, planId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Failed to get plan price and credits" });
    }
  });

  /**
   * POST /api/burn-credits
   * Redeems a quantity of credits from the user's Nevermined plan
   * Requires Authorization header with Bearer token
   * @body {number} credits - Amount of credits to redeem
   * @body {string} agentRequestId - The agent request ID
   * @returns {object} - { success: boolean, txHash?: string, message: string }
   */
  app.post("/api/burn-credits", async (req, res) => {
    const { credits } = req.body;
    if (!credits || isNaN(Number(credits)) || Number(credits) <= 0) {
      return res
        .status(400)
        .json({ error: "Missing or invalid credits amount" });
    }
    const planId =
      (req.headers["x-plan-id"] as string) || process.env.PLAN_ID || "";
    if (!planId) {
      return res.status(500).json({ error: "Missing plan DID" });
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Missing or invalid Authorization header" });
    }
    const nvmApiKey = authHeader.replace("Bearer ", "").trim();
    if (!nvmApiKey) {
      return res.status(401).json({ error: "Missing API Key" });
    }
    const result = await redeemCredits(planId, String(credits), nvmApiKey);
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json({ error: result.message });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
