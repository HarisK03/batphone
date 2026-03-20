"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/app/lib/supabase-client";

export default function AuthCallbackPage() {
	const router = useRouter();

	useEffect(() => {
		let cancelled = false;

		function safeReplace(path: string) {
			if (!cancelled) router.replace(path);
		}

		async function run() {
			const supabase = getSupabaseClient();

			// exchangeCodeForSession reads `code` from the URL itself.
			// After exchange, onAuthStateChange fires with SIGNED_IN —
			// wait for that instead of assuming the session is ready immediately.
			const params = new URLSearchParams(window.location.search);
			const code = params.get("code");

			if (!code) {
				safeReplace("/");
				return;
			}

			const { error } = await supabase.auth.exchangeCodeForSession(code);
			if (error) {
				console.error("Supabase OAuth exchange failed:", error);
				safeReplace("/");
				return;
			}

			// Wait for the auth state to settle before navigating.
			// exchangeCodeForSession is async but the session write to localStorage
			// and the onAuthStateChange broadcast can lag the promise resolution.
			await new Promise<void>((resolve) => {
				const { data } = supabase.auth.onAuthStateChange((event) => {
					if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
						data.subscription.unsubscribe();
						resolve();
					}
				});

				// Safety timeout — don't wait forever
				setTimeout(() => {
					data.subscription.unsubscribe();
					resolve();
				}, 3000);
			});

			safeReplace("/");
		}

		run();

		return () => {
			cancelled = true;
		};
	}, [router]);

	return (
		<div className="fixed inset-0 z-[1000] bg-neutral-950" />
	);
}
