"use client";

import { useEffect, useRef } from "react";
import { getSupabaseClient } from "@/app/lib/supabase-client";
import { FaGoogle } from "react-icons/fa";

export function BatPhoneLandingMobile() {
	// `variant="compact"` renders the same 3D phone, but without full-screen/fixed layout
	// and without the landing overlays (title/sign-in/drag hint).
	// Default behavior stays unchanged for the actual landing page.
	return <BatPhoneLandingMobileImpl variant="landing" />;
}

export function BatPhoneLandingMobileImpl({
	variant,
}: {
	variant: "landing" | "compact";
}) {
	const initializedRef = useRef(false);

	useEffect(() => {
		if (initializedRef.current) return;
		initializedRef.current = true;

		let raf = 0;
		let resizeObserver: ResizeObserver | null = null;
		const cleanupFns: Array<() => void> = [];

		async function loadThree() {
			if (typeof window === "undefined") return null;
			// @ts-expect-error - we rely on global THREE from the CDN
			if (window.THREE) return window.THREE;

			return new Promise<unknown>((resolve, reject) => {
				const existing = document.querySelector<HTMLScriptElement>(
					'script[data-three-cdn="r128"]',
				);
				if (existing) {
					existing.addEventListener("load", () => {
						// @ts-expect-error - global var from CDN
						resolve(window.THREE);
					});
					existing.addEventListener("error", reject);
					return;
				}

				const script = document.createElement("script");
				script.src =
					"https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
				script.async = true;
				script.dataset.threeCdn = "r128";
				script.onload = () => {
					// @ts-expect-error - global var from CDN
					resolve(window.THREE);
				};
				script.onerror = reject;
				document.head.appendChild(script);
			});
		}

		async function init() {
			const THREE = await loadThree();
			if (!THREE) return;

			const canvas = document.getElementById(
				"phoneCanvas",
			) as HTMLCanvasElement | null;
			if (!canvas) return;

			const hero = canvas.parentElement;
			if (!hero) return;

			const renderer = new THREE.WebGLRenderer({
				canvas,
				antialias: true,
				alpha: true,
			});
			renderer.setClearColor(0x000000, 0);
			renderer.shadowMap.enabled = true;
			renderer.shadowMap.type = THREE.PCFSoftShadowMap;
			renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

			const scene = new THREE.Scene();
			const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

			function resize() {
				const w = (hero as HTMLElement).clientWidth;
				const h = (hero as HTMLElement).clientHeight;
				renderer.setSize(w, h, false);
				camera.aspect = w / h;
				camera.updateProjectionMatrix();
			}

			resize();
			resizeObserver = new ResizeObserver(resize);
			resizeObserver.observe(hero);

			// LIGHTS
			scene.add(new THREE.AmbientLight(0xffffff, 0.75));
			const key = new THREE.DirectionalLight(0xffffff, 1.3);
			key.position.set(5, 9, 7);
			key.castShadow = true;
			scene.add(key);
			const fill = new THREE.DirectionalLight(0xff6644, 0.55);
			fill.position.set(-5, 2, 3);
			scene.add(fill);
			const rim = new THREE.DirectionalLight(0xffffff, 0.25);
			rim.position.set(0, -2, -5);
			scene.add(rim);

			const mR = new THREE.MeshPhongMaterial({
				color: 0xaa1111,
				shininess: 90,
				specular: 0xff7777,
			});
			const mRD = new THREE.MeshPhongMaterial({
				color: 0x7a0a0a,
				shininess: 50,
				specular: 0xff4444,
			});
			const mRL = new THREE.MeshPhongMaterial({
				color: 0xcc2222,
				shininess: 130,
				specular: 0xffaaaa,
			});
			const mBK = new THREE.MeshPhongMaterial({
				color: 0x111111,
				shininess: 30,
			});
			const mCH = new THREE.MeshPhongMaterial({
				color: 0xaaaaaa,
				shininess: 220,
				specular: 0xffffff,
			});
			const mFL = new THREE.MeshPhongMaterial({
				color: 0x1a0303,
			});

			const root = new THREE.Group();
			root.scale.set(1.0, 1.0, 1.0);
			scene.add(root);

			function add(
				geo: unknown,
				mat: unknown,
				x = 0,
				y = 0,
				z = 0,
				rx = 0,
				ry = 0,
				rz = 0,
				parent = root,
			) {
				const m = new THREE.Mesh(geo, mat);
				m.position.set(x, y, z);
				m.rotation.set(rx, ry, rz);
				m.castShadow = true;
				m.receiveShadow = true;
				parent.add(m);
				return m;
			}

			// ── BASE — clean rounded box via ExtrudeGeometry ──
			function makeRoundedBox(
				w: number,
				d: number,
				h: number,
				r: number,
			) {
				const hw = w / 2 - r,
					hd = d / 2 - r;
				const shape = new THREE.Shape();
				shape.moveTo(-hw, -hd - r);
				shape.lineTo(hw, -hd - r);
				shape.absarc(hw, -hd, r, -Math.PI / 2, 0, false);
				shape.lineTo(hw + r, hd);
				shape.absarc(hw, hd, r, 0, Math.PI / 2, false);
				shape.lineTo(-hw, hd + r);
				shape.absarc(-hw, hd, r, Math.PI / 2, Math.PI, false);
				shape.lineTo(-hw - r, -hd);
				shape.absarc(-hw, -hd, r, Math.PI, (3 * Math.PI) / 2, false);

				const geo = new THREE.ExtrudeGeometry(shape, {
					depth: h,
					bevelEnabled: true,
					bevelThickness: r,
					bevelSize: r,
					bevelSegments: 8,
					curveSegments: 16,
				});
				geo.rotateX(-Math.PI / 2);
				geo.translate(0, -h / 2, 0);
				geo.computeVertexNormals();
				return geo;
			}

			add(makeRoundedBox(2.6, 2.2, 1.05, 0.18), mR, 0, 0, 0);

			// Rubber feet
			(
				[
					[-1.0, -0.55, -0.8],
					[1.0, -0.55, -0.8],
					[-1.0, -0.55, 0.8],
					[1.0, -0.55, 0.8],
				] as [number, number, number][]
			).forEach(([x, y, z]) => {
				add(
					new THREE.CylinderGeometry(0.09, 0.11, 0.05, 10),
					mBK,
					x,
					y,
					z,
				);
			});

			// ── DIAL RECESS ──
			add(
				new THREE.CylinderGeometry(1.02, 1.02, 0.07, 32),
				mRD,
				0,
				0.62,
				0.1,
			);
			add(
				new THREE.CylinderGeometry(0.8, 0.8, 0.09, 32),
				mRD,
				0,
				0.65,
				0.1,
			);
			add(
				new THREE.CylinderGeometry(0.4, 0.4, 0.11, 24),
				mRD,
				0,
				0.68,
				0.1,
			);
			add(
				new THREE.CylinderGeometry(0.12, 0.12, 0.15, 12),
				mBK,
				0,
				0.72,
				0.1,
			);
			add(new THREE.SphereGeometry(0.12, 12, 8), mBK, 0, 0.8, 0.1);
			for (let i = 0; i < 8; i++) {
				const a = (i / 8) * Math.PI * 2;
				add(
					new THREE.CylinderGeometry(0.038, 0.038, 0.13, 8),
					mBK,
					Math.cos(a) * 0.25,
					0.72,
					0.1 + Math.sin(a) * 0.25,
				);
			}

			// ── CRADLE PRONGS ──
			([-0.68, 0.68] as number[]).forEach((x) => {
				add(
					new THREE.CylinderGeometry(0.09, 0.09, 0.52, 12),
					mR,
					x,
					0.77,
					-0.58,
				);
				add(new THREE.SphereGeometry(0.1, 12, 8), mR, x, 1.03, -0.58);
				add(
					new THREE.CylinderGeometry(0.105, 0.105, 0.06, 12),
					mCH,
					x,
					0.74,
					-0.58,
				);
			});
			add(new THREE.BoxGeometry(1.36, 0.1, 0.12), mR, 0, 0.51, -0.58);

			// ── FLOOR ──
			const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), mFL);
			floor.rotation.x = -Math.PI / 2;
			floor.position.y = -0.52;
			floor.receiveShadow = true;
			scene.add(floor);

			// ── HANDSET ──
			const hs = new THREE.Group();
			const hsPts: unknown[] = [];
			for (let i = 0; i <= 24; i++) {
				const t = i / 24;
				hsPts.push(
					new THREE.Vector3(
						-1.05 + t * 2.1,
						Math.sin(t * Math.PI) * 0.55,
						0,
					),
				);
			}
			const hsMesh = new THREE.Mesh(
				new THREE.TubeGeometry(
					new THREE.CatmullRomCurve3(hsPts),
					40,
					0.2,
					16,
					false,
				),
				mRL,
			);
			hsMesh.castShadow = true;
			hs.add(hsMesh);

			([-1.03, 1.03] as number[]).forEach((x) => {
				const cap = new THREE.Mesh(
					new THREE.SphereGeometry(0.32, 16, 12),
					mR,
				);
				cap.scale.set(0.85, 0.75, 1.0);
				cap.position.x = x;
				hs.add(cap);
				for (let i = 0; i < 6; i++) {
					const a = (i / 6) * Math.PI * 2;
					const d = new THREE.Mesh(
						new THREE.SphereGeometry(0.03, 6, 4),
						mBK,
					);
					d.position.set(x, Math.cos(a) * 0.15, Math.sin(a) * 0.15);
					hs.add(d);
				}
			});

			const band = new THREE.Mesh(
				new THREE.CylinderGeometry(0.22, 0.22, 0.16, 12),
				mCH,
			);
			band.rotation.z = Math.PI / 2;
			hs.add(band);

			const slotM = new THREE.Mesh(
				new THREE.BoxGeometry(1.4, 0.1, 0.28),
				mBK,
			);
			slotM.position.set(0, -0.15, 0);
			hs.add(slotM);

			hs.position.set(0, 1.18, -0.58);
			hs.rotation.x = -0.06;
			root.add(hs);

			// ── CAMERA ORBIT ──
			let isDrag = false;
			let ox = 0;
			let oy = 0;
			let theta = 0.55;
			let phi = 1.0;
			// Camera orbit radius.
			// Compact mode is shown in a smaller area, so we bring the camera in a bit.
			const RAD = variant === "compact" ? 10.2 : 12;

			function updateCam() {
				camera.position.set(
					RAD * Math.sin(phi) * Math.sin(theta),
					RAD * Math.cos(phi) + 0.3,
					RAD * Math.sin(phi) * Math.cos(theta),
				);
				camera.lookAt(0, 0.25, 0);
			}
			updateCam();

			let activePointerId: number | null = null;

			const onPointerMove = (e: PointerEvent) => {
				if (!isDrag) return;
				if (activePointerId != null && e.pointerId !== activePointerId)
					return;
				const dx = e.clientX - ox;
				const dy = e.clientY - oy;
				theta -= dx * 0.008;
				phi += dy * 0.006;
				phi = Math.max(0.28, Math.min(1.42, phi));
				ox = e.clientX;
				oy = e.clientY;
				updateCam();
			};

			const stopWindowListeners = () => {
				window.removeEventListener(
					"pointermove",
					onPointerMove as unknown as EventListener,
				);
				window.removeEventListener(
					"pointerup",
					onPointerUp as unknown as EventListener,
				);
				window.removeEventListener(
					"pointercancel",
					onPointerCancel as unknown as EventListener,
				);
			};

			const onPointerUp = (e: PointerEvent) => {
				if (activePointerId != null && e.pointerId !== activePointerId)
					return;
				isDrag = false;
				activePointerId = null;
				stopWindowListeners();
				try {
					canvas.releasePointerCapture(e.pointerId);
				} catch {
					/* ignore */
				}
			};

			const onPointerCancel = (e: PointerEvent) => {
				if (activePointerId != null && e.pointerId !== activePointerId)
					return;
				isDrag = false;
				activePointerId = null;
				stopWindowListeners();
			};

			const startWindowListeners = () => {
				window.addEventListener(
					"pointermove",
					onPointerMove as unknown as EventListener,
					{ passive: true },
				);
				window.addEventListener(
					"pointerup",
					onPointerUp as unknown as EventListener,
					{ passive: true },
				);
				window.addEventListener(
					"pointercancel",
					onPointerCancel as unknown as EventListener,
					{ passive: true },
				);
			};

			const onPointerDown = (e: PointerEvent) => {
				if (!e.isPrimary) return;
				e.preventDefault();
				isDrag = true;
				activePointerId = e.pointerId;
				ox = e.clientX;
				oy = e.clientY;
				try {
					canvas.setPointerCapture(e.pointerId);
				} catch {
					/* ignore */
				}
				startWindowListeners();
			};

			canvas.addEventListener("pointerdown", onPointerDown, {
				passive: false,
			});
			cleanupFns.push(() => {
				canvas.removeEventListener(
					"pointerdown",
					onPointerDown as unknown as EventListener,
				);
				stopWindowListeners();
			});

			(function loop() {
				raf = window.requestAnimationFrame(loop);
				renderer.render(scene, camera);
			})();
		}

		void init();

		return () => {
			if (resizeObserver) resizeObserver.disconnect();
			for (const fn of cleanupFns) fn();
			if (raf) window.cancelAnimationFrame(raf);
		};
	}, [initializedRef, variant]);

	return (
		<div className={["batphone-landing", variant === "compact" ? "batphone-compact" : ""].join(" ")}>
			<style>{`
				${variant === "landing" ? `html, body {
				  overflow: hidden;
				  height: 100%;
				}` : ``}
				.batphone-landing {
				  background: #0f0303;
				  position: fixed;
				  inset: 0;
				  height: 100vh;
				  width: 100%;
				  display: flex;
				  align-items: center;
				  justify-content: center;
				  padding: 0;
				  overflow: hidden;
				}
				.batphone-landing * { box-sizing: border-box; margin: 0; padding: 0; }
				:root {
				  --red: #aa1111;
				  --red-dark: #6e0808;
				  --red-light: #cc2222;
				  --cream: #f5f0e8;
				  --ink: #1a0505;
				  --gold: #c9a84c;
				}
				.phone-frame {
				  width: 100vw;
				  height: 100vh;
				  background: #0a0a0a;
				  border-radius: 0;
				  position: relative;
				  box-shadow: none;
				  overflow: hidden;
				  display: flex;
				  flex-direction: column;
				}

				/* Compact (embedded) variant overrides */
				.batphone-compact.batphone-landing {
				  position: relative;
				  inset: auto;
				  height: auto;
				  width: 100%;
				  overflow: visible;
				  display: block;
				  background: transparent;
				}
				.batphone-compact .phone-frame {
				  width: 100%;
				  height: 280px;
				  border-radius: 26px;
				  box-shadow: none;
				}
				.batphone-compact .phone-title-overlay,
				.batphone-compact .phone-subtitle-overlay,
				.batphone-compact .drag-hint,
				.batphone-compact .signin-wrap {
				  display: none !important;
				}

				.notch, .btn-vol, .btn-vol2, .btn-pwr { display: none; }
				.screen {
				  flex: 1;
				  position: relative;
				  overflow: hidden;
				  background: var(--ink);
				}
				.hero {
				  position: absolute;
				  inset: 0;
				  width: 100%;
				  height: 100%;
				  z-index: 10;
				  background: radial-gradient(ellipse at 50% 60%, #2a0808 0%, #0d0101 60%, #000 100%);
				  overflow: hidden;
				}
				#phoneCanvas {
				  position: absolute;
				  inset: 0;
				  width: 100%;
				  height: 100%;
				  display: block;
				  z-index: 0;
				  touch-action: none;
				}
				.phone-title-overlay {
				  position: absolute;
				  top: 12px;
				  left: 50%;
				  transform: translateX(-50%);
				  z-index: 50;
				  font-family: 'Bebas Neue', sans-serif;
				  font-size: 66px;
				  letter-spacing: 1.4px;
				  color: var(--cream);
				  white-space: nowrap;
				  pointer-events: none;
				}
				.phone-subtitle-overlay {
				  position: absolute;
				  top: 92px;
				  left: 50%;
				  transform: translateX(-50%);
				  z-index: 51;
				  font-family: 'Bebas Neue', sans-serif;
				  font-size: 15px;
				  line-height: 1.2;
				  color: rgba(245,240,232,0.65);
				  text-align: center;
				  padding: 0 18px;
				  white-space: nowrap;
				  pointer-events: none;
				}
				.drag-hint {
				  position: absolute;
				  bottom: 150px;
				  left: 50%;
				  transform: translateX(-50%);
				  font-family: 'Bebas Neue', sans-serif;
				  font-size: 12px;
				  letter-spacing: 3px;
				  color: var(--cream);
				  opacity: 0.65;
				  white-space: nowrap;
				  z-index: 9999;
				  pointer-events: none;
				}
				.signin-wrap {
				  position: absolute;
				  left: 50%;
				  transform: translateX(-50%);
				  width: min(360px, 88vw);
				  top: 150px;
				  z-index: 220;
				  pointer-events: auto;
				}
				.btn-primary {
				  flex: 1;
				  background: var(--red);
				  color: var(--cream);
				  font-family: 'Bebas Neue', sans-serif;
				  font-size: 15px;
				  letter-spacing: 3px;
				  border: none;
				  border-radius: 50px;
				  padding: 16px 0;
				  cursor: pointer;
				  transition: background 0.2s;
				}
				.btn-primary:active { background: var(--red-dark); }
			`}</style>

			<div className="phone-frame">
				{/* Title + subtitle sit above everything */}
				<div className="phone-title-overlay">BAT PHONE</div>
				<div className="phone-subtitle-overlay">
					Call, record & transcribe.
				</div>

				{/* Drag hint — direct child of phone-frame, above signin-wrap */}
				<div className="drag-hint">DRAG TO ROTATE</div>

				<div className="notch">
					<div className="notch-pill" />
				</div>
				<div className="btn-vol" />
				<div className="btn-vol2" />
				<div className="btn-pwr" />

				<div className="screen">
					<div className="hero">
						<canvas id="phoneCanvas" />
					</div>
				</div>

				<div
					className="signin-wrap"
					style={{
						padding: "0 12px 10px",
						color: "#f5f0e8",
						textAlign: "center",
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						gap: 6,
					}}
				>
					<button
						type="button"
						className="btn-primary"
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							gap: 6,
							width: "fit-content",
							padding: "8px 16px",
							lineHeight: "16px",
							fontSize: 12,
						}}
						onClick={async () => {
							const origin = window.location.origin;
							await getSupabaseClient().auth.signInWithOAuth({
								provider: "google",
								options: {
									redirectTo: `${origin}/auth/callback`,
								},
							});
						}}
					>
						<FaGoogle
							size={16}
							style={{
								flexShrink: 0,
								display: "block",
								alignSelf: "center",
								margin: 0,
							}}
						/>
						<span
							style={{
								lineHeight: "16px",
								display: "block",
								transform: "translateY(0.5px)",
							}}
						>
							SIGN IN WITH GOOGLE
						</span>
					</button>
				</div>
			</div>
		</div>
	);
}
