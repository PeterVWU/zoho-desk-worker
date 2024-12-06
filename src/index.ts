/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
interface Env {
	ZOHO_DESK_DOMAIN: string,
	ZOHO_DESK_ORGID: string,
}

interface TicketData {
	subject: string;
	departmentId: string;
	contactId: string;
	description: string;
	[key: string]: unknown;  // Allow additional fields
}

interface ZohoErrorResponse {
	errorCode?: string;
	message?: string;
}


export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		// Only allow POST requests
		if (request.method !== 'POST') {
			return new Response('Method not allowed', {
				status: 405,
				headers: { 'Allow': 'POST' }
			});
		}

		try {
			// Get ticket data from request body
			const ticketData = await request.json() as TicketData;

			// Get a fresh access token
			const tokenResponse = await getAccessToken();
			const accessToken = tokenResponse.access_token;

			// Create ticket in Zoho
			const zohoResponse = await fetch(`https://${env.ZOHO_DESK_DOMAIN}/api/v1/tickets`, {
				method: 'POST',
				headers: {
					'orgId': env.ZOHO_DESK_ORGID,
					'Authorization': `Zoho-oauthtoken ${accessToken}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					...ticketData
				})
			});

			const responseData = await zohoResponse.json();

			if (!zohoResponse.ok) {
				const errorData = responseData as ZohoErrorResponse;
				throw new Error(errorData.message || 'Failed to create ticket');
			}

			return new Response(JSON.stringify(responseData), {
				status: zohoResponse.status,
				headers: {
					'Content-Type': 'application/json'
				}
			});

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			return new Response(JSON.stringify({ error: errorMessage }), {
				status: 500,
				headers: {
					'Content-Type': 'application/json'
				}
			});
		}
	}
};

async function getAccessToken(): Promise<{ access_token: string }> {
	const response = await fetch('https://your-auth-worker.workers.dev/token');
	if (!response.ok) {
		throw new Error('Failed to get access token');
	}
	return response.json();
}