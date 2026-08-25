"use client";

import { Activity, LogOut, Zap } from "lucide-react";
import { useAuth } from "@/lib/firebase/auth-context";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BusinessSwitcher } from "@/components/layout/business-switcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface TopbarProps {
  automationPaused?: boolean;
  onToggleAutomation?: () => void;
  onRunQueue?: () => void;
  runningQueue?: boolean;
  togglingAutomation?: boolean;
}

export function Topbar({
  automationPaused = true,
  onToggleAutomation,
  onRunQueue,
  runningQueue = false,
  togglingAutomation = false,
}: TopbarProps) {
  const { user, logout } = useAuth();

  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5"
      style={{ marginLeft: "var(--sidebar-width, 220px)" }}
    >
      {/* Left — Business Switcher & automation status toggle */}
      <div className="flex items-center gap-3">
        <BusinessSwitcher />
        <button
          onClick={onToggleAutomation}
          disabled={togglingAutomation}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-all cursor-pointer",
            automationPaused
              ? "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100"
              : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          )}
        >
        <span
          className={cn(
            "size-2 rounded-full",
            automationPaused
              ? "bg-slate-300"
              : "bg-emerald-500 animate-pulse-dot"
          )}
        />
        <Activity className="size-3.5" />
        {togglingAutomation
          ? "Updating…"
          : automationPaused
          ? "Automation OFF — click to start"
          : "Automation RUNNING"}
      </button>
    </div>

      <div className="flex items-center gap-2">
        {/* Run now button (only when active) */}
        {!automationPaused && (
          <button
            disabled={runningQueue}
            onClick={onRunQueue}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-60"
          >
            <Zap className="size-3.5" />
            {runningQueue ? "Running…" : "Run now"}
          </button>
        )}

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-slate-600 hover:bg-slate-100 transition-colors">
              <Avatar className="size-6">
                <AvatarFallback className="bg-blue-100 text-[10px] font-bold text-blue-700">
                  {user?.email?.slice(0, 2).toUpperCase() ?? "DC"}
                </AvatarFallback>
              </Avatar>
              <span className="hidden font-medium md:block">
                {user?.email?.split("@")[0]}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-[11px] font-normal text-slate-400">
              {user?.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void logout()}
              className="text-red-600 focus:bg-red-50 focus:text-red-700 cursor-pointer"
            >
              <LogOut className="size-3.5" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
