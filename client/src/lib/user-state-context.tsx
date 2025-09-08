import React, { createContext, useContext, useState, useEffect } from "react";
import { extractApiKeyFromUrl, extractPlanIdFromUrl } from "./utils";

/**
 * Context for the global user state (API Key and credits)
 * @module user-state-context
 */

interface UserStateContextType {
  apiKey: string;
  setApiKey: (key: string) => void;
  credits: number | null;
  setCredits: (c: number | null) => void;
  refreshCredits: () => Promise<void>;
  initialized: boolean;
  planId: string;
  setPlanId: (planId: string) => void;
}

const UserStateContext = createContext<UserStateContextType | undefined>(
  undefined
);

export function useUserState() {
  const ctx = useContext(UserStateContext);
  if (!ctx)
    throw new Error("useUserState must be used within UserStateProvider");
  return ctx;
}

export function UserStateProvider({ children }: { children: React.ReactNode }) {
  // Synchronous initialization
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem("nvmApiKey") || ""
  );
  const [planId, setPlanId] = useState<string>(
    () => localStorage.getItem("nvmPlanId") || ""
  );
  const [credits, setCredits] = useState<number | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Refreshes the credits from the backend
  const refreshCredits = async () => {
    try {
      if (!apiKey) {
        setCredits(null);
        return;
      }
      const planIdHeader = localStorage.getItem("nvmPlanId") || "";
      const resp = await fetch("/api/credit", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(planIdHeader ? { "X-Plan-Id": planIdHeader } : {}),
        },
      });
      if (!resp.ok) throw new Error();
      const data = await resp.json();
      setCredits(typeof data.credit === "number" ? data.credit : null);
    } catch {
      setCredits(null);
    }
  };

  // Refresh credits when the API Key changes
  useEffect(() => {
    (async () => {
      await refreshCredits();
      setInitialized(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // On first mount, parse api key from return_url and store it
  useEffect(() => {
    const parsedKey = extractApiKeyFromUrl(true);
    if (parsedKey) {
      localStorage.setItem("nvmApiKey", parsedKey);
      setApiKey(parsedKey);
    }
    const parsedPlan = extractPlanIdFromUrl(true);
    if (parsedPlan) {
      localStorage.setItem("nvmPlanId", parsedPlan);
      setPlanId(parsedPlan);
    }
    // We don't include setters in deps to avoid loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for changes in localStorage to refresh credits after burning in other tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "nvmCreditsUpdated") {
        refreshCredits();
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  return (
    <UserStateContext.Provider
      value={{
        apiKey,
        setApiKey,
        credits,
        setCredits,
        refreshCredits,
        initialized,
        planId,
        setPlanId,
      }}
    >
      {children}
    </UserStateContext.Provider>
  );
}
