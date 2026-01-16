import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Chat from "@/pages/chat";
import { ChatProvider } from "@/lib/chat-context";
import { ThemeProvider } from "@/lib/theme-context";
import { UserStateProvider } from "@/lib/user-state-context";
import { useEffect } from "react";
import { useUserState } from "@/lib/user-state-context";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Chat} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  console.log("[demo-agent-ui] App.tsx loaded");

  // On mount, if we have a pending action (e.g., returned from checkout), resume it
  function ResumePending() {
    const { initialized } = useUserState();
    useEffect(() => {
      if (!initialized) return;
      try {
        const raw = localStorage.getItem("pendingChatAction");
        if (!raw) return;
        const pending = JSON.parse(raw);
        if (
          pending?.type === "sendMessage" &&
          typeof pending.content === "string"
        ) {
          // Dispatch a custom event that ChatProvider can listen to, or use window-level storage
          const event = new CustomEvent("resume-chat-action", {
            detail: pending,
          });
          window.dispatchEvent(event);
          localStorage.removeItem("pendingChatAction");
        }
      } catch {
        // ignore
      }
    }, [initialized]);
    return null;
  }
  return (
    <QueryClientProvider client={queryClient}>
      <UserStateProvider>
        <ChatProvider>
          <ThemeProvider>
            <ResumePending />
            <Router />
            <Toaster />
          </ThemeProvider>
        </ChatProvider>
      </UserStateProvider>
    </QueryClientProvider>
  );
}
