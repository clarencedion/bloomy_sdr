"use client";

import Link from "next/link";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/firebase/auth-context";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface TopbarProps {
  /** Whether the SDR engine is currently allowed to run. */
  automationPaused?: boolean;
}

/**
 * Deliberately quiet. Operational levers (pause automation, run research now)
 * live in Advanced; the top bar only states whether the SDR is working.
 */
export function Topbar({ automationPaused = true }: TopbarProps) {
  const { user, logout } = useAuth();

  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center justify-end gap-3 border-b border-slate-200 bg-white px-5 md:justify-between"
      style={{ marginLeft: "var(--sidebar-width, 240px)" }}
    >
      <Link
        href="/app/advanced"
        className="hidden items-center gap-2 text-[13px] text-slate-500 transition-colors hover:text-slate-800 md:flex"
      >
        {/* Solid, always: the colour is the state. Nothing loops in the shell, on every page. */}
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", automationPaused ? "bg-slate-300" : "bg-emerald-500")}
        />
        {automationPaused ? "SDR paused" : "SDR working"}
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-slate-600 transition-colors hover:bg-slate-100">
            <Avatar className="size-6">
              <AvatarFallback className="bg-slate-200 text-[10px] font-bold text-slate-700">
                {user?.email?.slice(0, 2).toUpperCase() ?? "DC"}
              </AvatarFallback>
            </Avatar>
            <span className="hidden font-medium md:block">{user?.email?.split("@")[0]}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-[11px] font-normal text-slate-400">
            {user?.email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/app/settings">Settings</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => void logout()}
            className="cursor-pointer text-red-600 focus:bg-red-50 focus:text-red-700"
          >
            <LogOut className="size-3.5" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
