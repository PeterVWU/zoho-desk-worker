interface Env {
	ZOHO_DESK_DOMAIN: string;
	ZOHO_DESK_ORGID: string;
	ZOHO_OAUTH_WORKER_URL: string;

	MAGENTO_API_URL: string;
	MAGENTO_API_TOKEN: string;

	CLOUDTALK_USERNAME: string;
	CLOUDTALK_PASSWORD: string;

	ZOHO_OAUTH_WORKER: any
}

interface TicketData {
	subject: string;
	departmentId: string;
	contactId?: string;
	phone: string;
	email?: string;
	voicemailRecordingLink: string;
	voicemailTranscription: string;
	[key: string]: unknown;
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

export default {
	async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
		const url = new URL(request.url);
		try {
			// Ticket creation route
			if (url.pathname === '/tickets') {
				ctx.waitUntil(handleTicketCreation(request, env))
				return new Response(JSON.stringify({ status: 'processing', message: 'Request received' }), {
					status: 202,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			return new Response('Not found', { status: 404 });
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			log('error', 'Unhandled exception in fetch handler', { error: errorMessage });
			return new Response(JSON.stringify({ error: errorMessage }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}
};

// Ticket Handler
async function handleTicketCreation(request: Request, env: Env): Promise<Response> {
	if (request.method !== 'POST') {
		log('warn', `Invalid request method: ${request.method}`);
		return new Response('Method not allowed', { status: 405 });
	}

	try {
		log('info', 'handleTicketCreation header', { headers: JSON.stringify(request.headers) })
		// Get ticket data from request
		const ticketData = await request.json() as TicketData;
		log('info', 'Received ticket data', { ticketData });

		// Get valid access token
		const accessToken = await env.ZOHO_OAUTH_WORKER.getAccessToken();
		log('info', 'Retrieved valid Zoho access token');

		let ticketDescription = "";
		if (ticketData.email) {
			// Fetch customer details from Magento
			const customerDetails = await getCustomerDetails(ticketData.email, env);
			log('info', 'Fetched customer details from Magento', { email: ticketData.email });

			const orderHistory = await getOrderHistory(ticketData.email, env);
			log('info', 'Fetched order history from Magento', { orderCount: orderHistory.length });

			// Create ticket description with customer and order info
			ticketDescription = createDetailedDescription(ticketData, customerDetails, orderHistory);

		} else {
			// Create ticket description without customer and order info
			ticketDescription = createDetailedDescription(ticketData, null, []);
		}

		// Create ticket in Zoho Desk
		const ticketResponse = await fetch(`https://${env.ZOHO_DESK_DOMAIN}/api/v1/tickets`, {
			method: 'POST',
			headers: {
				'orgId': env.ZOHO_DESK_ORGID,
				'Authorization': `Zoho-oauthtoken ${accessToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				subject: ticketData.subject,
				phone: ticketData.phone,
				departmentId: ticketData.departmentId,
				contactId: ticketData.contactId,
				description: ticketDescription
			})
		});

		const responseData = await ticketResponse.json();
		log('info', 'Ticket created in Zoho Desk', { status: ticketResponse.status, responseData });

		return new Response(JSON.stringify(responseData), {
			status: ticketResponse.status,
			headers: { 'Content-Type': 'application/json' }
		});

	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		log('error', 'Error during ticket creation', { error: errorMessage });
		return new Response(JSON.stringify({ error: errorMessage }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}

// Fetch customer details from Magento
async function getCustomerDetails(email: string, env: Env): Promise<any> {
	log('info', 'Fetching customer details from Magento', { email });

	const response = await fetch(`${env.MAGENTO_API_URL}/customers/search?searchCriteria[filter_groups][0][filters][0][field]=email&searchCriteria[filter_groups][0][filters][0][value]=${encodeURIComponent(email)}&searchCriteria[filter_groups][0][filters][0][condition_type]=eq`, {
		headers: {
			'Authorization': `Bearer ${env.MAGENTO_API_TOKEN}`,
			'Content-Type': 'application/json'
		}
	});

	log('info', 'Magento API response received for customer details', { status: response.status });

	if (!response.ok) {
		log('error', 'Failed to fetch customer details from Magento', { status: response.status, statusText: response.statusText });
		throw new Error(`Failed to fetch customer details: ${response.statusText}`);
	}

	const data: any = await response.json();
	const customer = data.items?.[0] || null;

	if (customer) {
		log('info', 'Customer details retrieved from Magento', { customerId: customer.id });
	} else {
		log('warn', 'No customer details found in Magento for the provided email', { email });
	}

	return customer;
}

// Fetch order history from Magento
async function getOrderHistory(email: string, env: Env): Promise<any[]> {
	log('info', 'Fetching order history from Magento', { email });

	const response = await fetch(
		`${env.MAGENTO_API_URL}/orders?searchCriteria[filter_groups][0][filters][0][field]=customer_email` +
		`&searchCriteria[filter_groups][0][filters][0][value]=${encodeURIComponent(email)}` +
		`&searchCriteria[filter_groups][0][filters][0][condition_type]=eq` +
		`&searchCriteria[sortOrders][0][field]=created_at&searchCriteria[sortOrders][0][direction]=DESC` +
		`&searchCriteria[pageSize]=5`,
		{
			headers: {
				'Authorization': `Bearer ${env.MAGENTO_API_TOKEN}`,
				'Content-Type': 'application/json',
			},
		}
	);

	log('info', 'Magento API response received for order history', { status: response.status });

	if (!response.ok) {
		log('error', 'Failed to fetch order history from Magento', { status: response.status, statusText: response.statusText });
		throw new Error(`Failed to fetch order history: ${response.statusText}`);
	}

	const data: any = await response.json();
	const orders = data.items || [];

	log('info', 'Order history retrieved from Magento', { orderCount: orders.length });

	return orders;
}

// Create detailed ticket description
function createDetailedDescription(ticketData: TicketData, customerDetails: any, orderHistory: any[]): string {
	log('info', 'Creating detailed ticket description', { ticketData, customerDetails, orderHistory });

	const descriptionArray = [];

	// Voicemail details
	descriptionArray.push(`<div><strong>Voicemail Recording:</strong> <a href="${ticketData.voicemailRecordingLink}">${ticketData.voicemailRecordingLink}</a></div>`);
	descriptionArray.push(`<div><strong>Voicemail Transcription:</strong> ${ticketData.voicemailTranscription}</div>`);

	if (customerDetails) {
		// Add the note about the accuracy of customer information
		descriptionArray.push(`<div style="color: orange; font-weight: bold;">Note: The following customer information is based on the provided phone number and may not be entirely accurate. Please verify the details.</div>`);

		// Customer details
		descriptionArray.push(`<div><strong>Customer Name:</strong> ${customerDetails.firstname} ${customerDetails.lastname}</div>`);
		descriptionArray.push(`<div><strong>Email:</strong> ${customerDetails.email}</div>`);
	}

	if (orderHistory.length > 0) {
		descriptionArray.push('<div><strong>Order History:</strong></div>');
		orderHistory.forEach(order => {
			descriptionArray.push(`<div>- <strong>Order ID:</strong> ${order.increment_id}, <strong>Total:</strong> ${order.grand_total}, <strong>Status:</strong> ${order.status}</div>`);
		});
	}

	return descriptionArray.join('<br/>');
}

async function fetchAccessToken(env: Env): Promise<string> {
	const response = await fetch(`https://${env.ZOHO_OAUTH_WORKER_URL}/token`, {
		method: 'GET',
	});
	log('info', 'token url', `https://${env.ZOHO_OAUTH_WORKER_URL}/token`)
	if (!response.ok) {
		throw new Error(`Failed to fetch access token: ${response.statusText}`);
	}

	const data: any = await response.json();
	if (!data.access_token) {
		throw new Error('No access token returned from OAuth worker.');
	}

	return data.access_token;
}