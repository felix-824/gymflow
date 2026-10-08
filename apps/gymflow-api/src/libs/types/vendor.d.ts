declare module 'bcryptjs' {
	export function genSalt(rounds?: number): Promise<string>;
	export function hash(password: string, salt: string | number): Promise<string>;
	export function compare(password: string, hash: string): Promise<boolean>;
}
declare module 'graphql-upload' {
	import { Readable } from 'node:stream';
	import { GraphQLScalarType } from 'graphql';
	import { RequestHandler } from 'express';
	export interface FileUpload {
		filename: string;
		mimetype: string;
		encoding: string;
		createReadStream(this: void): Readable;
	}
	export const GraphQLUpload: GraphQLScalarType;
	export function graphqlUploadExpress(options?: { maxFileSize?: number; maxFiles?: number }): RequestHandler;
}
