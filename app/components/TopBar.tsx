"use client";

import { getSupabaseClient } from "@/app/lib/supabase-client";
import { FaSignOutAlt } from "react-icons/fa";

type SupabaseUser = { id: string; email?: string | null };

export function TopBar({ user }: { user: SupabaseUser | null }) {
	return (
		<header className="fixed top-0 left-0 right-0 px-4 py-3 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur z-50 relative">
			{/* Subtle highlight line (adds life without harsh red borders) */}
			<div
				aria-hidden
				className="absolute left-0 right-0 bottom-0 h-px bg-gradient-to-r from-red-500/50 via-red-500/20 to-transparent pointer-events-none"
			/>
			<div className="max-w-md mx-auto flex items-center justify-between">
				<div className="flex flex-col min-w-0">
					<span
						className="text-[22px] font-semibold text-neutral-100 uppercase tracking-[1.4px]"
						style={{ fontFamily: "'Bebas Neue', sans-serif" }}
					>
						BAT PHONE
					</span>
				</div>
				<button
					type="button"
					className="rounded-full bg-red-500 text-neutral-100 text-xs px-3 py-1.5 flex-shrink-0 ml-4 hover:bg-red-600 transition-colors flex items-center justify-center shadow-sm shadow-red-500/20"
					onClick={async () => {
						if (user) {
							await getSupabaseClient().auth.signOut();
							return;
						}
						const origin = window.location.origin;
						await getSupabaseClient().auth.signInWithOAuth({
							provider: "google",
							options: { redirectTo: `${origin}/auth/callback` },
						});
					}}
				>
					{user ? (
						<span className="inline-flex items-center gap-2 leading-none">
							<FaSignOutAlt size={14} className="leading-none" />
							<span>Sign out</span>
						</span>
					) : (
						"Sign in with Google"
					)}
				</button>
			</div>
		</header>
	);
}
