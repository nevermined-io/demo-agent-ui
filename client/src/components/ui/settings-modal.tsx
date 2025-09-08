import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./dialog";
import { Input } from "./input";
import { Button } from "./button";
import { Slider } from "./slider";
import { useUserState } from "@/lib/user-state-context";
import { useChat } from "@/lib/chat-context";

/**
 * Modal for configuring the Nevermined API Key and Plan ID.
 * Allows the user to set and persist the API Key and Plan ID in localStorage.
 * Validates the API Key by calling /api/credit before saving.
 * @component
 * @param {boolean} open - Whether the modal is open
 * @param {function} onClose - Function to call when closing the modal
 * @param {function} [onApiKeySaved] - Function to call after saving a valid API Key
 * @returns {JSX.Element}
 */
export default function SettingsModal(props: {
  open: boolean;
  onClose: () => void;
  onApiKeySaved?: () => void;
}) {
  return <SettingsModalContent {...props} />;
}

function SettingsModalContent({
  open,
  onClose,
  onApiKeySaved,
}: {
  open: boolean;
  onClose: () => void;
  onApiKeySaved?: () => void;
}) {
  const {
    apiKey,
    setApiKey,
    credits,
    setCredits,
    refreshCredits,
    planId,
    setPlanId,
  } = useUserState();
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [burnAmount, setBurnAmount] = useState(0);
  const [burnLoading, setBurnLoading] = useState(false);
  const [burnError, setBurnError] = useState("");
  const [burnSuccess, setBurnSuccess] = useState("");
  const [localPlanId, setLocalPlanId] = useState("");

  useEffect(() => {
    if (open) {
      const stored = localStorage.getItem("nvmApiKey") || "";
      setApiKey(stored);
      const storedPlan = localStorage.getItem("nvmPlanId") || "";
      setLocalPlanId(storedPlan);
      setTouched(false);
      setError("");
      setLoading(false);
      setBurnAmount(0);
      setBurnError("");
      setBurnSuccess("");
      refreshCredits();
    }
  }, [open]);

  useEffect(() => {
    if (typeof credits === "number" && burnAmount > credits) {
      setBurnAmount(credits);
    }
  }, [credits]);

  const apiKeyValid = !!apiKey.trim() && !loading && !error;
  const burnDisabled =
    !apiKeyValid || typeof credits !== "number" || credits <= 0 || burnLoading;

  /**
   * Validates the API Key by calling /api/credit with the given key.
   * If valid, saves the key and closes the modal. If not, shows an error.
   */
  const handleSave = async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch("/api/credit", {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      });
      if (!resp.ok) throw new Error("Invalid API Key");
      localStorage.setItem("nvmApiKey", apiKey.trim());
      if (localPlanId.trim()) {
        localStorage.setItem("nvmPlanId", localPlanId.trim());
        setPlanId(localPlanId.trim());
      }
      setTouched(false);
      setLoading(false);
      refreshCredits();
      if (onApiKeySaved) onApiKeySaved();
      onClose();
    } catch (e) {
      setError("Invalid API Key. Please check and try again.");
      setLoading(false);
    }
  };

  /**
   * Burns credits
   * @returns {Promise<void>}
   */
  const handleBurn = async (): Promise<void> => {
    setBurnLoading(true);
    setBurnError("");
    setBurnSuccess("");
    try {
      const resp = await fetch("/api/burn-credits", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({ credits: burnAmount }),
      });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error || "Error burning credits");
      }
      const data = await resp.json();
      setBurnSuccess(data.message || "Credits burned successfully.");
      setBurnAmount(0);
      await refreshCredits();
      localStorage.setItem("nvmCreditsUpdated", Date.now().toString());
    } catch (e: any) {
      setBurnError(e.message || "Error burning credits");
    } finally {
      setBurnLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="p-4 rounded-lg border bg-muted/40">
          <div className="mb-2">
            <div className="text-base font-medium">Nevermined API Key</div>
            <div className="text-xs text-muted-foreground">
              Enter your Nevermined API Key. With this key, you will be able to
              interact with a swarm of agents that will create a music video
              based on your prompt.
            </div>
          </div>
          <Input
            type="text"
            placeholder="Enter your NVM API Key"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setTouched(true);
              setError("");
            }}
            autoFocus
            disabled={loading}
          />
          {error && <div className="text-red-600 text-sm mt-2">{error}</div>}
        </div>
        <div className="mt-4 p-4 rounded-lg border bg-muted/40">
          <div className="mb-2">
            <div className="text-base font-medium">Plan ID</div>
            <div className="text-xs text-muted-foreground">
              Enter the Plan DID to be used for credit checks and burns. You can
              override the current value returned from checkout here.
            </div>
          </div>
          <Input
            type="text"
            placeholder="Enter Plan DID"
            value={localPlanId}
            onChange={(e) => {
              setLocalPlanId(e.target.value);
              setTouched(true);
            }}
            disabled={loading}
          />
          <div className="text-xs text-muted-foreground mt-1">
            Current plan: {planId || "(none)"}
          </div>
          <DialogFooter className="mt-2">
            <Button onClick={handleSave} disabled={!apiKey.trim() || loading}>
              {loading ? "Validating..." : "Save"}
            </Button>
          </DialogFooter>
        </div>
        {/* <div className="p-4 rounded-lg border bg-muted/40">
          <div className="font-semibold mb-2">Burn credits</div>
          <div className="text-xs text-muted-foreground mb-4">
            Burn a chosen amount of your available credits. This action is
            irreversible and will permanently remove the selected credits from
            your balance. Use this if you want to reduce your credit balance for
            testing or demonstration purposes.
          </div>
          <div className="flex flex-col sm:flex-row gap-4 mb-2 w-full">
            <Slider
              min={0}
              max={typeof credits === "number" ? credits : 0}
              step={1}
              value={[burnAmount]}
              onValueChange={([val]) => setBurnAmount(val)}
              disabled={burnDisabled}
              className="flex-1 h-8"
            />
            <Input
              type="number"
              min={0}
              max={typeof credits === "number" ? credits : 0}
              value={burnAmount}
              onChange={(e) => {
                let v = Number(e.target.value);
                if (isNaN(v)) v = 0;
                if (typeof credits === "number" && v > credits) v = credits;
                if (v < 0) v = 0;
                setBurnAmount(v);
              }}
              disabled={burnDisabled}
              className="w-full sm:w-24"
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={handleBurn}
              disabled={burnDisabled || burnAmount <= 0}
            >
              {burnLoading ? "Burning..." : "Burn"}
            </Button>
          </div>
          {burnError && (
            <div className="text-red-600 text-sm mt-2">{burnError}</div>
          )}
          {burnSuccess && (
            <div className="text-green-600 text-sm mt-2">{burnSuccess}</div>
          )}
        </div> */}
        {/* Clear conversation history */}
        <div className="mt-4 p-4 rounded-lg border bg-muted/40">
          <div className="font-semibold mb-2">Conversation History</div>
          <div className="text-xs text-muted-foreground mb-4">
            Clear all saved conversations and messages from this device.
          </div>
          <div className="flex justify-end">
            <ClearHistoryButton onCleared={onClose} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ClearHistoryButton({ onCleared }: { onCleared?: () => void }) {
  const { clearHistory } = useChat();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex items-center gap-2">
      {confirming ? (
        <>
          <Button
            variant="destructive"
            onClick={() => {
              clearHistory();
              setConfirming(false);
              if (onCleared) onCleared();
            }}
          >
            Confirm clear
          </Button>
          <Button variant="outline" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Clear conversation history
        </Button>
      )}
    </div>
  );
}
