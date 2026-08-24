"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { SettingsClient } from "@/components/settings-client";

interface SettingsDialogContextValue {
  openSettings: () => void;
  closeSettings: () => void;
}

const SettingsDialogContext = createContext<SettingsDialogContextValue | null>(null);

export function SettingsDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(
    () => ({
      openSettings: () => setOpen(true),
      closeSettings: () => setOpen(false),
    }),
    [],
  );

  return (
    <SettingsDialogContext.Provider value={value}>
      {children}
      <SettingsClient open={open} onOpenChange={setOpen} />
    </SettingsDialogContext.Provider>
  );
}

export function useSettingsDialog() {
  const context = useContext(SettingsDialogContext);
  if (!context) throw new Error("useSettingsDialog must be used within SettingsDialogProvider");
  return context;
}
