import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	InternalServerErrorException,
	ServiceUnavailableException,
	UnauthorizedException,
} from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { Message } from '../src/libs/enums/common.enum';
import { formatGraphqlError, graphqlOptions } from '../src/libs/graphql.config';

const privateDetails =
	'mongodb://private-user:private-password@private-host/private-db C:/private/uploads token=secret';
function format(error: Error, production = true) {
	const wrapped = new GraphQLError(error.message, { originalError: error, path: ['operation'] });
	return formatGraphqlError(
		{
			...wrapped.toJSON(),
			extensions: { code: 'INTERNAL_SERVER_ERROR', stacktrace: [privateDetails], raw: privateDetails },
		},
		wrapped,
		production,
	);
}
describe('central GraphQL production policy', () => {
	it('explicitly disables production Playground, introspection and stacks', () => {
		expect(graphqlOptions(true)).toMatchObject({
			playground: false,
			introspection: false,
			includeStacktraceInErrorResponses: false,
		});
	});
	it('keeps development exploration and diagnostics enabled', () => {
		expect(graphqlOptions(false)).toMatchObject({
			playground: true,
			introspection: true,
			includeStacktraceInErrorResponses: true,
		});
	});
	it.each([
		new BadRequestException('Invalid program target'),
		new UnauthorizedException('Authentication required'),
		new ForbiddenException('Role not permitted'),
		new ConflictException('Program changed; reload before retrying'),
		new ServiceUnavailableException('Image upload is busy. Please try again.'),
	])('preserves expected application messages without exception objects: %s', (error) => {
		const result = format(error);
		expect(result.message).toBe(error.message);
		expect(Object.keys(result.extensions!)).toEqual(['code']);
		expect(JSON.stringify(result)).not.toContain(privateDetails);
	});
	it.each([Message.WRONG_PASSWORD, Message.NO_MEMBER_NICK, Message.BLOCKED_USER, Message.SELF_SUBSCRIPTION_DENIED])(
		'preserves legacy business errors using HTTP 500: %s',
		(message) => {
			expect(format(new InternalServerErrorException(message)).message).toBe(message);
		},
	);
	it('preserves useful validation details as a valid GraphQL message string', () => {
		expect(
			format(new BadRequestException(['programName must be a string', 'programPrice must be an integer'])).message,
		).toBe('programName must be a string; programPrice must be an integer');
	});
	it.each([
		'PROGRAM_CREATE_PAYLOAD_CONFLICT',
		'PROGRAM_CREATE_UNAVAILABLE',
		'PROGRAM_WRITE_CONTENTION',
		'PROGRAM_REVISION_CONFLICT',
	])('preserves the established frontend reason %s', (reason) => {
		expect(
			format(new ConflictException({ message: 'Reload before retrying', reason, raw: privateDetails })).extensions,
		).toEqual({ code: 'INTERNAL_SERVER_ERROR', reason });
	});
	it('drops arbitrary reason fields', () => {
		expect(format(new ConflictException({ message: 'Conflict', reason: privateDetails })).extensions).toEqual({
			code: 'INTERNAL_SERVER_ERROR',
		});
	});
	it.each([
		new Error(privateDetails),
		new InternalServerErrorException(privateDetails),
		new ServiceUnavailableException(privateDetails),
	])('masks unexpected production errors: %s', (error) => {
		expect(format(error)).toEqual({
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Internal server error',
			extensions: { code: 'INTERNAL_SERVER_ERROR' },
		});
	});
	it('does not trust a resolver error that spoofs a public error code', () => {
		const error = new GraphQLError(privateDetails, { path: ['operation'], extensions: { code: 'BAD_USER_INPUT' } });
		expect(formatGraphqlError(error.toJSON(), error, true).message).toBe('Internal server error');
	});
	it('does not echo private values from pre-execution input validation', () => {
		const error = new GraphQLError(privateDetails, { extensions: { code: 'BAD_USER_INPUT' } });
		expect(formatGraphqlError(error.toJSON(), error, true)).toEqual({
			code: 'BAD_USER_INPUT',
			message: 'Invalid GraphQL input',
			extensions: { code: 'BAD_USER_INPUT' },
		});
	});
	it('retains detailed unexpected messages in development', () => {
		expect(format(new Error(privateDetails), false).message).toBe(privateDetails);
	});
});
