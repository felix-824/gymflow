import { HttpException } from '@nestjs/common';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { unwrapResolverError } from '@apollo/server/errors';
import { GraphQLFormattedError } from 'graphql';
import { Message } from './enums/common.enum';
import type { GraphQLAuthContext } from './types/auth-context';

const legacyBusinessMessages = new Set<string>(Object.values(Message));
const publicReasons = new Set([
	'PROGRAM_CREATE_PAYLOAD_CONFLICT',
	'PROGRAM_CREATE_UNAVAILABLE',
	'PROGRAM_WRITE_CONTENTION',
	'PROGRAM_REVISION_CONFLICT',
]);

export function formatGraphqlError(
	formatted: GraphQLFormattedError,
	original: unknown,
	production: boolean,
): GraphQLFormattedError & { code: string } {
	const exception = unwrapResolverError(original);
	let code = typeof formatted.extensions?.code === 'string' ? formatted.extensions.code : 'INTERNAL_SERVER_ERROR';
	let message = formatted.message;
	let reason: string | undefined;
	let expected = false;
	if (exception instanceof HttpException) {
		const status = exception.getStatus();
		const response = exception.getResponse();
		const detail = typeof response === 'object' ? (response as { message?: unknown; reason?: unknown }) : undefined;
		const messages = detail?.message ?? response;
		message =
			typeof messages === 'string'
				? messages
				: Array.isArray(messages) && messages.every((item) => typeof item === 'string')
					? messages.join('; ')
					: exception.message;
		expected =
			(status >= 400 && status < 500) ||
			(status === 500 && legacyBusinessMessages.has(message)) ||
			(status === 503 && message === 'Image upload is busy. Please try again.');
		if (expected && typeof detail?.reason === 'string' && publicReasons.has(detail.reason)) reason = detail.reason;
	}
	if (production && !expected) {
		// Pre-execution GraphQL validation may echo submitted values. Keep codes useful, not their raw diagnostics.
		const requestErrors: Record<string, string> = {
			GRAPHQL_PARSE_FAILED: 'Invalid GraphQL syntax',
			GRAPHQL_VALIDATION_FAILED: 'Invalid GraphQL operation',
			BAD_USER_INPUT: 'Invalid GraphQL input',
			BAD_REQUEST: 'Invalid GraphQL request',
			OPERATION_RESOLUTION_FAILURE: 'Invalid GraphQL operation',
			PERSISTED_QUERY_NOT_FOUND: 'PersistedQueryNotFound',
			PERSISTED_QUERY_NOT_SUPPORTED: 'PersistedQueryNotSupported',
		};
		// A resolver cannot make its arbitrary error public by setting a well-known extensions.code.
		if (!formatted.path && requestErrors[code]) message = requestErrors[code];
		else {
			code = 'INTERNAL_SERVER_ERROR';
			message = 'Internal server error';
		}
	}
	return {
		code,
		message,
		extensions: { code, ...(reason ? { reason } : {}) },
	};
}

export function graphqlOptions(production = process.env.NODE_ENV === 'production'): ApolloDriverConfig {
	return {
		driver: ApolloDriver,
		playground: !production,
		introspection: !production,
		includeStacktraceInErrorResponses: !production,
		autoSchemaFile: true,
		context: ({ req, res }: GraphQLAuthContext) => ({ req, res }),
		formatError: (formatted, original) => formatGraphqlError(formatted, original, production),
	};
}
