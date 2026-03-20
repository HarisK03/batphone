"use client";

import { useState } from "react";
import { FaAddressBook, FaCog, FaHistory, FaPhone } from "react-icons/fa";
import { PhoneSettings } from "./PhoneSettings";
import { ContactsPanel } from "./ContactsPanel";
import { CallHistory } from "./CallHistory";
import { CallBatPhone } from "./CallBatPhone";

type TabId = "settings" | "contacts" | "history" | "call";

export function MobileBottomTabs() {
	const [tab, setTab] = useState<TabId>("settings");

	const tabMeta: Record<
		TabId,
		{ title: string; Icon: React.ComponentType<{ size?: number }> }
	> = {
		settings: { title: "Settings", Icon: FaCog },
		contacts: { title: "Contacts", Icon: FaAddressBook },
		history: { title: "Recents", Icon: FaHistory },
		call: { title: "Call Bat Phone", Icon: FaPhone },
	};

	const navLabel: Record<TabId, string> = {
		settings: "Settings",
		contacts: "Contacts",
		history: "Recents",
		call: "Call",
	};

	const { title, Icon } = tabMeta[tab];

	return (
		<div className="relative">
			{/* Content (keep space for fixed bottom nav) */}
			<div className="pb-24 mt-0 space-y-4">
				<div className="flex items-center gap-2">
					<span className="w-9 h-9 bg-red-500/15 rounded-md flex items-center justify-center text-red-500">
						<Icon size={22} />
					</span>
					<h1 className="text-3xl font-semibold text-neutral-100 leading-tight">
						{title}
					</h1>
				</div>

				{tab === "settings" && (
					<section className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-sm p-4 relative overflow-hidden">
						<div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-red-500/70 via-red-500/25 to-transparent" />
						<PhoneSettings />
					</section>
				)}
				{tab === "contacts" && (
					<section className="bg-transparent border-0 shadow-none p-0 relative overflow-visible">
						<ContactsPanel />
					</section>
				)}
				{tab === "history" && (
					<section className="bg-transparent border-0 shadow-none p-0 relative overflow-visible">
						<CallHistory />
					</section>
				)}
				{tab === "call" && (
					<section className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-sm p-4 relative overflow-hidden">
						<div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-red-500/70 via-red-500/25 to-transparent" />
						<CallBatPhone />
					</section>
				)}
			</div>

			{/* Fixed bottom tab bar */}
			<nav className="fixed bottom-0 left-0 right-0 bg-neutral-950/90 backdrop-blur border-t border-neutral-800 z-50 shadow-[0_-10px_30px_rgba(0,0,0,0.6)]">
				<div className="flex justify-around">
					<TabButton
						active={tab === "settings"}
						ariaLabel="Settings"
						label={navLabel.settings}
						onClick={() => setTab("settings")}
						icon={<FaCog size={18} />}
					/>
					<TabButton
						active={tab === "contacts"}
						ariaLabel="Contacts"
						label={navLabel.contacts}
						onClick={() => setTab("contacts")}
						icon={<FaAddressBook size={18} />}
					/>
					<TabButton
						active={tab === "history"}
						ariaLabel="Recents"
						label={navLabel.history}
						onClick={() => setTab("history")}
						icon={<FaHistory size={18} />}
					/>
					<TabButton
						active={tab === "call"}
						ariaLabel="Call Bat Phone"
						label={navLabel.call}
						onClick={() => setTab("call")}
						icon={<FaPhone size={18} />}
					/>
				</div>
			</nav>
		</div>
	);
}

function TabButton({
	active,
	ariaLabel,
	label,
	onClick,
	icon,
}: {
	active: boolean;
	ariaLabel: string;
	label: string;
	onClick: () => void;
	icon: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={ariaLabel}
			className={[
				"flex flex-col items-center justify-center w-full py-1.5 gap-0.5",
				active ? "text-red-500" : "text-neutral-500",
			].join(" ")}
			onClick={onClick}
		>
			<span
				className={[
					"p-2 rounded-xl transition-colors",
					active
						? "bg-red-500/15 text-red-500"
						: "bg-transparent text-neutral-500",
				].join(" ")}
			>
				{icon}
			</span>
			<span className="text-[10px] leading-3 font-semibold">{label}</span>
		</button>
	);
}

