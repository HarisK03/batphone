"use client";

import { useEffect, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { PhoneSettings } from "./components/PhoneSettings";
import { ContactsPanel } from "./components/ContactsPanel";
import { CallHistory } from "./components/CallHistory";
import { CallBatPhone } from "./components/CallBatPhone";
import { BatPhoneLandingMobile } from "./components/BatPhoneLandingMobile";
import { MobileBottomTabs } from "./components/MobileBottomTabs";
import { getSupabaseClient } from "./lib/supabase-client";

type SupabaseUserLite = { id: string; email?: string | null };

export default function Home() {
	// undefined = auth state not resolved yet (prevents flash between signed-out/in)
	const [user, setUser] = useState<SupabaseUserLite | null | undefined>(
		undefined,
	);
	const loaderStartedAtRef = useRef<number>(0);

	useEffect(() => {
		let cancelled = false;
		const supabase = getSupabaseClient();
		loaderStartedAtRef.current = Date.now();

		async function setUserWithMinDelay(next: SupabaseUserLite | null) {
			const elapsed = Date.now() - loaderStartedAtRef.current;
			const remaining = Math.max(0, 1000 - elapsed);
			if (remaining) {
				await new Promise((r) => setTimeout(r, remaining));
			}
			if (!cancelled) setUser(next);
		}

		async function load() {
			const { data } = await supabase.auth.getUser();
			if (cancelled) return;
			void setUserWithMinDelay(
				data.user ? { id: data.user.id, email: data.user.email } : null,
			);
		}

		load();

		const { data: listenerData } = supabase.auth.onAuthStateChange(
			(_event, session) => {
				void setUserWithMinDelay(
					session?.user
						? { id: session.user.id, email: session.user.email }
						: null,
				);
			},
		);

		return () => {
			cancelled = true;
			listenerData.subscription.unsubscribe();
		};
	}, []);

	return (
		<div className="min-h-screen flex flex-col bg-neutral-950 text-neutral-100">
			{user && <TopBar user={user} />}

			{user === undefined ? (
				<div className="flex-1 w-full mt-8" />
			) : user ? (
				<>
					{/* Mobile */}
					<div
						className="md:hidden flex-1 w-full mt-8 px-4 overflow-y-auto"
						data-mobile-scroll-container
					>
						<MobileBottomTabs />
					</div>

					{/* Desktop */}
					<main className="hidden md:block flex-1 w-full max-w-md mx-auto px-4 py-6 space-y-6 mt-8">
						<div className="space-y-4">
							<section className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-sm p-4">
								<h2 className="text-sm font-semibold mb-2 text-neutral-100">
									1. Your phone number
								</h2>
								<p className="text-xs text-neutral-300">
									Configure the mobile number you will call the bat
									phone from.
								</p>
								<PhoneSettings />
							</section>
							<section className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-sm p-4">
								<h2 className="text-sm font-semibold mb-2 text-neutral-100">
									2. Contacts
								</h2>
								<p className="text-xs text-neutral-300">
									Add the people you want to reach via the bat
									phone.
								</p>
								<ContactsPanel />
							</section>
							<section className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-sm p-4">
								<h2 className="text-sm font-semibold mb-2 text-neutral-100">
									3. Call history
								</h2>
								<p className="text-xs text-neutral-300">
									Recently completed calls and transcripts.
								</p>
								<CallHistory />
							</section>
							<section className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-sm p-4">
								<h2 className="text-sm font-semibold mb-2 text-neutral-100">
									4. Call Bat Phone
								</h2>
								<CallBatPhone />
							</section>
						</div>
					</main>
				</>
			) : (
				<div className="flex-1 w-full">
					<BatPhoneLandingMobile />
				</div>
			)}
		</div>
	);
}
