interface Env {
	ZOHO_DESK_DOMAIN: string;
	ZOHO_DESK_ORGID: string;
	ZOHO_OAUTH_WORKER_URL: string;


	ZOHO_OAUTH_WORKER: any
}

interface TicketData {
	store: string;
	name: string;
	email: string;
	subject: string;
	orderNumber?: string;
	details: string;
	departmentId: string;
}

// Logging Helper Function
function log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
	const logEntry = {
		timestamp: new Date().toISOString(),
		level,
		message,
		data: data || {}
	};
	console[level](JSON.stringify(logEntry));
}

// Define allowed origins
const ALLOWED_ORIGINS = [
	'https://misthub.com',
	'https://ejuices.com',
	'https://www.ejuices.com',
	'https://eliquid.com',
	'https://www.eliquid.com',
	'https://ejuices.co',
	'https://www.ejuices.co'
];

// Helper function to add CORS headers by checking the request's Origin header
function withCorsHeaders(request: Request, response: Response): Response {
	const newHeaders = new Headers(response.headers);
	const requestOrigin = request.headers.get('Origin');
	if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
		newHeaders.set('Access-Control-Allow-Origin', requestOrigin);
	} else {
		// Fallback: you can either set a default or skip setting the header.
		newHeaders.set('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: newHeaders
	});
}

export default {
	async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
		const url = new URL(request.url);

		// Handle CORS preflight OPTIONS request
		if (request.method === 'OPTIONS') {
			const optionsResp = new Response(null, {
				status: 204,
				headers: {
					'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0],
					'Access-Control-Allow-Methods': 'POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type',
					'Access-Control-Max-Age': '86400'
				}
			});
			return withCorsHeaders(request, optionsResp);
		}

		try {
			// Ticket creation route
			if (url.pathname === '/tickets') {
				await handleTicketCreation(request, env);
				const resp = new Response(JSON.stringify({ status: 'processing', message: 'Request received' }), {
					status: 202,
					headers: { 'Content-Type': 'application/json' },
				});
				return withCorsHeaders(request, resp);
			}

			const notFoundResp = new Response('Not found', { status: 404 });
			return withCorsHeaders(request, notFoundResp);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			log('error', 'Unhandled exception in fetch handler', { error: errorMessage });
			const errResp = new Response(JSON.stringify({ error: errorMessage }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
			return withCorsHeaders(request, errResp);
		}
	}
};

// Ticket Handler
async function handleTicketCreation(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'POST') {
		log('warn', `Invalid request method: ${request.method}`);
		// Wrap the error response with CORS headers too
		return withCorsHeaders(request, new Response('Method not allowed', { status: 405 }));
	}

	try {
		log('info', 'handleTicketCreation header', { headers: JSON.stringify(request.headers) });
		// Get ticket data from request
		const ticketData = await request.json() as TicketData;
		log('info', 'Received ticket data', { ticketData });

		// Get valid access token
		const accessToken = await env.ZOHO_OAUTH_WORKER.getAccessToken();
		log('info', 'Retrieved valid Zoho access token');

		let ticketDescription = createDetailedDescription(ticketData);
		const ticketSubject = `${ticketData.store} | ${ticketData.subject} | ${ticketData.name}`;

		// Create ticket in Zoho Desk
		const ticketResponse = await fetch(`https://${env.ZOHO_DESK_DOMAIN}/api/v1/tickets`, {
			method: 'POST',
			headers: {
				'orgId': env.ZOHO_DESK_ORGID,
				'Authorization': `Zoho-oauthtoken ${accessToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				subject: ticketSubject,
				email: ticketData.email,
				description: ticketDescription,
				contact: {
					firstName: ticketData.name,
					lastName: ticketData.name,
					email: ticketData.email,
				},
				departmentId: ticketData.departmentId,
			})
		});

		const responseData = await ticketResponse.json();
		log('info', 'Ticket created in Zoho Desk', { status: ticketResponse.status, responseData });

		const resp = new Response(JSON.stringify(responseData), {
			status: ticketResponse.status,
			headers: { 'Content-Type': 'application/json' }
		});
		return withCorsHeaders(request, resp);

	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		log('error', 'Error during ticket creation', { error: errorMessage });
		const errResp = new Response(JSON.stringify({ error: errorMessage }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
		return withCorsHeaders(request, errResp);
	}
}

// Create detailed ticket description
function createDetailedDescription(ticketData: TicketData): string {
	const descriptionArray = [];

	if (ticketData.orderNumber) {
		descriptionArray.push(`<div><strong>Order Number:</strong>${ticketData.orderNumber}</div>`);
	}
	descriptionArray.push(`<div><strong>Detail:</strong> ${ticketData.details}</div>`);

	return descriptionArray.join('<br/>');
}

