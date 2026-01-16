import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { FullMessage, ChatContextType } from "./chat-types";
import { getCurrentBlockNumber, sendMessageToAgent } from "./chat-api";
import { storedConversations, storedMessages } from "./chat-mocks";
import { Conversation } from "@shared/schema";
import {
  llmRouterRequest,
  titleSummarizeRequest,
  intentSynthesizeRequest,
  getPlanCostRequest,
} from "./chat-requests";
import { buildNeverminedCheckoutUrl } from "./utils";
import { useUserState } from "./user-state-context";

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { apiKey, credits, refreshCredits } = useUserState();
  const [messages, setMessages] = useState<FullMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<
    number | null
  >(null);
  const [isStoredConversation, setIsStoredConversation] = useState(false);
  const hydratedRef = useRef(false);

  // Debug: log agent id presence on mount
  useEffect(() => {
    const agentId =
      (import.meta as any).env?.VITE_AGENT_ID ||
      (globalThis as any)?.__RUNTIME_CONFIG__?.VITE_AGENT_ID ||
      (globalThis as any)?.__RUNTIME_CONFIG__?.agentId;
    console.log("[demo-agent-ui] agentId =", agentId);
    if (!agentId) {
      console.warn(
        "[demo-agent-ui] Missing agentId - checkout links will not include agent id"
      );
    }
    const environment =
      (import.meta as any).env?.VITE_NVM_ENVIRONMENT ||
      (globalThis as any)?.__RUNTIME_CONFIG__?.VITE_NVM_ENVIRONMENT;
    console.log("[demo-agent-ui] VITE_NVM_ENVIRONMENT =", environment);
    if (!environment) {
      console.warn(
        "[demo-agent-ui] Missing VITE_NVM_ENVIRONMENT - checkout links will not include environment"
      );
    }
  }, []);

  // Deduplicate helpers
  const dedupeMessages = (items: FullMessage[]): FullMessage[] => {
    const seen = new Set<string>();
    const result: FullMessage[] = [];
    for (const msg of items) {
      const key = JSON.stringify({
        c: msg.content,
        t: msg.type,
        u: msg.isUser,
        v: msg.conversationId,
        x: msg.txHash || "",
        cr: msg.credits ?? null,
        p: msg.planId || "",
      });
      if (!seen.has(key)) {
        seen.add(key);
        result.push(msg);
      }
    }
    return result;
  };

  const dedupeConversations = (items: Conversation[]): Conversation[] => {
    const seen = new Set<number>();
    const result: Conversation[] = [];
    for (const c of items) {
      if (!seen.has(c.id as number)) {
        seen.add(c.id as number);
        result.push(c);
      }
    }
    return result;
  };

  const onMessageTypingComplete = () => {
    // This function is kept for compatibility but no longer needed
  };

  // Keys for localStorage
  const LS_MESSAGES_KEY = "chat_messages";
  const LS_CONVERSATIONS_KEY = "chat_conversations";
  const LS_CURRENT_CONV_ID_KEY = "chat_current_conversation_id";

  // Persist messages and conversations on every change
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(LS_MESSAGES_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(LS_CONVERSATIONS_KEY, JSON.stringify(conversations));
    } catch {}
  }, [conversations]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      if (currentConversationId === null) {
        localStorage.removeItem(LS_CURRENT_CONV_ID_KEY);
      } else {
        localStorage.setItem(
          LS_CURRENT_CONV_ID_KEY,
          String(currentConversationId)
        );
      }
    } catch {}
  }, [currentConversationId]);

  // Load from localStorage on first mount (fallback to stored mocks if empty)
  useEffect(() => {
    try {
      const rawMsgs = localStorage.getItem(LS_MESSAGES_KEY);
      const rawConvs = localStorage.getItem(LS_CONVERSATIONS_KEY);
      const rawCurrent = localStorage.getItem(LS_CURRENT_CONV_ID_KEY);
      const parsedMsgsRaw: FullMessage[] = rawMsgs ? JSON.parse(rawMsgs) : [];
      const parsedMsgs = dedupeMessages(parsedMsgsRaw);
      const parsedConvsRaw: Conversation[] = rawConvs
        ? JSON.parse(rawConvs)
        : [...storedConversations];
      const parsedConvs: Conversation[] = dedupeConversations(
        parsedConvsRaw.map((c) => ({
          ...c,
          timestamp: c.timestamp ? new Date(c.timestamp as any) : null,
        }))
      );
      setMessages(parsedMsgs);
      setConversations(
        [...parsedConvs].sort(
          (a, b) =>
            (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0)
        )
      );
      setCurrentConversationId(rawCurrent ? Number(rawCurrent) : null);
      setIsStoredConversation(
        Boolean(parsedMsgs.length === 0 && parsedConvs.length > 0)
      );
      hydratedRef.current = true;
    } catch {
      setMessages([]);
      setConversations(
        [...storedConversations].sort(
          (a, b) =>
            (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0)
        )
      );
      setCurrentConversationId(null);
      hydratedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Clears all persisted conversation data and pending chat actions from localStorage,
   * and resets in-memory chat state.
   * This removes:
   * - chat_messages
   * - chat_conversations
   * - chat_current_conversation_id
   * - pendingChatAction (unprocessed/pending message intent)
   * @returns {void}
   */
  const clearHistory = (): void => {
    setMessages([]);
    setConversations([]);
    setCurrentConversationId(null);
    try {
      localStorage.removeItem(LS_MESSAGES_KEY);
      localStorage.removeItem(LS_CONVERSATIONS_KEY);
      localStorage.removeItem(LS_CURRENT_CONV_ID_KEY);
      localStorage.removeItem("pendingChatAction");
    } catch {}
  };

  // Resume pending action after returning from checkout
  useEffect(() => {
    const handler = (e: Event) => {
      const detail: any = (e as CustomEvent).detail;
      if (
        detail?.type === "sendMessage" &&
        typeof detail.content === "string"
      ) {
        // Re-send the original message content
        sendMessage(detail.content);
      }
    };
    window.addEventListener("resume-chat-action", handler as EventListener);
    return () =>
      window.removeEventListener(
        "resume-chat-action",
        handler as EventListener
      );
  }, []);

  const sendMessage = async (content: string) => {
    setIsStoredConversation(false);

    // Add the user message to the chat
    const userMessage: FullMessage = {
      id: messages.length,
      content,
      type: "answer",
      isUser: true,
      conversationId: currentConversationId?.toString() || "new",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Build LLM history including the latest user message
    const completeMessages = [...messages, userMessage];
    const llmHistory = completeMessages.map((m) => ({
      role: m.isUser ? "user" : "assistant",
      content: m.content,
    }));

    // Call the LLM router before sending to the agent
    let llmAction: "forward" | "no_credit" | "order_plan" | "no_action" =
      "forward";
    let llmReason = "";
    try {
      const { action, message, reason } = await llmRouterRequest(
        content,
        llmHistory
      );
      llmAction = action;
      llmReason = message || reason || "";
    } catch (e) {
      // If router fails (e.g., network), do not force agent usage
      llmAction = "no_action";
      llmReason =
        "I can chat without using the agent. Ask me anything or try again.";
    }

    // Checkout redirects for explicit router outcomes
    if (llmAction === "no_credit" || llmAction === "order_plan") {
      try {
        const agentId =
          (import.meta as any).env?.VITE_AGENT_ID ||
          (globalThis as any)?.__RUNTIME_CONFIG__?.VITE_AGENT_ID ||
          (globalThis as any)?.__RUNTIME_CONFIG__?.agentId;
        const hasApiKey = Boolean(apiKey);
        const checkoutUrl = buildNeverminedCheckoutUrl(agentId, {
          returnApiKey: !hasApiKey,
        });

        // Persist pending intent to resume after returning
        localStorage.setItem(
          "pendingChatAction",
          JSON.stringify({ type: "sendMessage", content })
        );

        // Show a message with a clickable checkout link instead of redirecting
        setMessages((prev) => [
          ...prev,
          {
            id: prev.length + 1,
            content: `${
              llmReason && llmReason.trim()
                ? llmReason.trim()
                : llmAction === "no_credit"
                ? "You have no credits."
                : "Purchase is required to continue."
            } Please complete the agent checkout: ${checkoutUrl}`,
            type: "notice",
            isUser: false,
            conversationId: currentConversationId?.toString() || "new",
            timestamp: new Date(),
          },
        ]);
        return;
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: prev.length + 1,
            content: "Unable to redirect to checkout. Please try again.",
            type: "error",
            isUser: false,
            conversationId: currentConversationId?.toString() || "new",
            timestamp: new Date(),
          },
        ]);
        return;
      }
    }

    // If router says forward but we have no API key or credits are zero, go to checkout
    if (llmAction === "forward") {
      const needsApiKey = !apiKey;
      const insufficientCredits = credits !== null && credits <= 0;
      if (needsApiKey || insufficientCredits) {
        try {
          const agentId =
            (import.meta as any).env?.VITE_AGENT_ID ||
            (globalThis as any)?.__RUNTIME_CONFIG__?.VITE_AGENT_ID ||
            (globalThis as any)?.__RUNTIME_CONFIG__?.agentId;
          const checkoutUrl = buildNeverminedCheckoutUrl(agentId, {
            returnApiKey: needsApiKey,
          });
          setMessages((prev) => [
            ...prev,
            {
              id: prev.length + 1,
              content: `${
                needsApiKey ? "No API Key found." : "Insufficient credits."
              } Please complete the agent checkout: ${checkoutUrl}`,
              type: "notice",
              isUser: false,
              conversationId: currentConversationId?.toString() || "new",
              timestamp: new Date(),
            },
          ]);
          localStorage.setItem(
            "pendingChatAction",
            JSON.stringify({ type: "sendMessage", content })
          );
          return;
        } catch {
          setMessages((prev) => [
            ...prev,
            {
              id: prev.length + 1,
              content: "Unable to redirect to checkout. Please try again.",
              type: "error",
              isUser: false,
              conversationId: currentConversationId?.toString() || "new",
              timestamp: new Date(),
            },
          ]);
          return;
        }
      }
    }

    if (llmAction === "no_action") {
      // Add the LLM's message as an 'answer' type in the chat
      setMessages((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          content: llmReason || "",
          type: "answer",
          isUser: false,
          conversationId: currentConversationId?.toString() || "new",
          timestamp: new Date(),
        },
      ]);
      return;
    }

    // If the LLM says 'forward', follow the normal flow
    if (!currentConversationId) {
      // Get synthesized title from backend
      let title = content.slice(0, 30) + "...";
      try {
        const data = await titleSummarizeRequest(llmHistory);
        if (data.title) title = data.title;
      } catch (e) {
        console.error(e);
      }
      const newConversation: Conversation = {
        id: conversations.length + 1,
        title,
        timestamp: new Date(),
      };
      setConversations((prev) => [newConversation, ...prev]);
      setCurrentConversationId(newConversation.id);
    }

    // Use intent synthesis for agent prompt
    let agentPrompt = "";
    try {
      const data = await intentSynthesizeRequest(llmHistory);
      if (data.intent) {
        agentPrompt = data.intent;
      } else {
        // Do not fallback to raw content; require synthesized intent
        setMessages((prev) => [
          ...prev,
          {
            id: prev.length + 1,
            content: "Unable to synthesize intent. Please try again.",
            type: "error",
            isUser: false,
            conversationId: currentConversationId?.toString() || "new",
            timestamp: new Date(),
          },
        ]);
        return;
      }
    } catch (e) {
      // Do not fallback to raw content; require synthesized intent
      setMessages((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          content: "Unable to synthesize intent. Please try again.",
          type: "error",
          isUser: false,
          conversationId: currentConversationId?.toString() || "new",
          timestamp: new Date(),
        },
      ]);
      return;
    }

    try {
      // Send message to the new agent
      const blockNumber = await getCurrentBlockNumber();
      // Add temporary thinking message
      const thinkingId = Date.now();
      setMessages((prev) => [
        ...prev,
        {
          id: thinkingId,
          content: "...",
          type: "thinking",
          isUser: false,
          conversationId: currentConversationId?.toString() || "new",
          timestamp: new Date(),
        },
      ]);
      const agentResponse = await sendMessageToAgent(agentPrompt);

      // Remove thinking message and add the agent's response
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== thinkingId),
        {
          id: prev.length + 1,
          content: agentResponse.response,
          type: "answer",
          isUser: false,
          conversationId: currentConversationId?.toString() || "new",
          timestamp: new Date(),
        },
      ]);

      // Handle payment info if present
      if (agentResponse.creditsRedeemed) {
        setMessages((prev) => [
          ...prev,
          {
            id: prev.length + 1,
            content: `Task completed. ${agentResponse.creditsRedeemed} credit${
              agentResponse.creditsRedeemed === 1 ? "" : "s"
            } have been deducted from your balance.${
              agentResponse.remainingBalance !== undefined
                ? ` Remaining: ${agentResponse.remainingBalance}`
                : ""
            }`,
            type: "nvm-transaction-user",
            isUser: false,
            conversationId: currentConversationId?.toString() || "new",
            timestamp: new Date(),
            txHash: agentResponse.txHash,
            credits: agentResponse.creditsRedeemed,
          },
        ]);

        // Calculate and show cost
        try {
          const data = await getPlanCostRequest();
          const planPrice = Number(data.planPrice);
          const planCredits = Number(data.planCredits);
          const creditsUsed = Number(agentResponse.creditsRedeemed);
          const cost =
            planCredits > 0 ? (planPrice / planCredits) * creditsUsed : 0;
          setMessages((prev) => [
            ...prev,
            {
              id: prev.length + 1,
              content: `The final cost has been ${cost.toFixed(4)} USDC.`,
              type: "usd-info",
              isUser: false,
              conversationId: currentConversationId?.toString() || "new",
              timestamp: new Date(),
            },
          ]);
        } catch (e) {
          console.error(e);
        }
      }
      // Refresh the credits badge after agent interaction
      try {
        await refreshCredits();
      } catch {}
    } catch (error) {
      console.error(error);
      setMessages((prev) => [
        ...prev.filter((m) => m.type !== "thinking"),
        {
          id: prev.length + 1,
          content: "Error communicating with the agent. Please try again.",
          type: "error",
          isUser: false,
          conversationId: currentConversationId?.toString() || "new",
          timestamp: new Date(),
        },
      ]);
    }
  };

  const loadStoredMessages = (conversationId: number) => {
    const storedConversationMessages = storedMessages[conversationId];
    if (storedConversationMessages) {
      setMessages(storedConversationMessages as FullMessage[]);
      setIsStoredConversation(true);
    }
  };

  const handleSetCurrentConversationId = (id: number | null) => {
    setCurrentConversationId(id);
    if (id !== null) {
      loadStoredMessages(id);
    }
  };

  const startNewConversation = () => {
    handleSetCurrentConversationId(null);
  };

  return (
    <ChatContext.Provider
      value={{
        messages,
        conversations,
        currentConversationId,
        isStoredConversation,
        sendMessage,
        setCurrentConversationId: handleSetCurrentConversationId,
        startNewConversation,
        onMessageTypingComplete,
        clearHistory,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
