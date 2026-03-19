import { ensureUserFromRequest } from "@/app/lib/auth-request";

export async function GET(request: Request) {
	const user = await ensureUserFromRequest(request);

	return Response.json({
		user: user
			? {
					id: user.id,
					email: user.email ?? null,
				}
			: null,
	});
}
