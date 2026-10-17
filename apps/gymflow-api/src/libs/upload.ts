import {
	BadRequestException,
	ForbiddenException,
	HttpException,
	InternalServerErrorException,
	ServiceUnavailableException,
} from '@nestjs/common';
import { link, mkdir, mkdtemp, rm, stat, unlink } from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
import type { FileUpload } from 'graphql-upload';
import type { NextFunction, Request, Response } from 'express';
import {
	getSerialForImage,
	IMAGE_UPLOAD_MAX_BYTES,
	IMAGE_UPLOAD_MAX_PIXELS,
	PROGRAM_MAX_IMAGES,
	validMimeTypes,
} from './config';
import { MemberType } from './enums/member.enum';

let activeUploads = 0;

export async function uploadDirectory(target: string): Promise<string> {
	if (!['member', 'article', 'program'].includes(target)) throw new BadRequestException('Invalid upload target');
	const directory = path.join('uploads', target);
	await mkdir(directory, { recursive: true });
	return directory;
}

// Authentication remains in AuthGuard. Both resolver mutations use this same boundary.
export async function saveUploadedImages(
	files: (Promise<FileUpload> | FileUpload)[],
	target: string,
	memberType: MemberType,
): Promise<string[]> {
	if (!['member', 'article', 'program'].includes(target)) throw new BadRequestException('Invalid upload target');
	if (
		!Object.values(MemberType).includes(memberType) ||
		(target === 'program' && ![MemberType.TRAINER, MemberType.ADMIN].includes(memberType))
	)
		throw new ForbiddenException('Role not permitted for upload target');
	if (!Array.isArray(files) || !files.length || files.length > PROGRAM_MAX_IMAGES)
		throw new BadRequestException('Upload between 1 and 5 images.');
	// Bounded admission and sequential decoding avoid an unbounded in-process queue.
	if (activeUploads >= 2) throw new ServiceUnavailableException('Image upload is busy. Please try again.');
	activeUploads++;
	const published: string[] = [];
	let temporary: string | undefined;
	try {
		const directory = await uploadDirectory(target);
		const temporaryRoot = path.resolve('uploads', '.tmp');
		await mkdir(temporaryRoot, { recursive: true });
		temporary = await mkdtemp(path.join(temporaryRoot, 'batch-'));
		const processed: { source: string; destination: string }[] = [];
		for (const promise of files) {
			const file = await promise;
			if (
				!file.filename ||
				/[/\\]/.test(file.filename) ||
				file.filename.includes(String.fromCharCode(0)) ||
				!validMimeTypes.includes(file.mimetype)
			)
				throw new BadRequestException('Only JPEG, PNG and WebP images are allowed.');
			let size = 0;
			const chunks: Buffer[] = [];
			for await (const chunk of file.createReadStream() as AsyncIterable<Uint8Array>) {
				const bytes = Buffer.from(chunk);
				size += bytes.length;
				if (size > IMAGE_UPLOAD_MAX_BYTES) throw new BadRequestException('Image exceeds the 5 MiB limit.');
				chunks.push(bytes);
			}
			if (!size) throw new BadRequestException('Image upload failed.');
			const image = sharp(Buffer.concat(chunks), { limitInputPixels: IMAGE_UPLOAD_MAX_PIXELS, failOn: 'warning' });
			const metadata = await image.metadata();
			const format = metadata.format;
			if (format !== 'jpeg' && format !== 'png' && format !== 'webp')
				throw new BadRequestException('Only JPEG, PNG and WebP images are allowed.');
			if ((metadata.pages ?? 1) !== 1) throw new BadRequestException('Animated images are not allowed.');
			const extensions = format === 'jpeg' ? ['.jpg', '.jpeg'] : ['.' + format];
			const mime = format === 'jpeg' ? ['image/jpeg', 'image/jpg'] : ['image/' + format];
			if (!extensions.includes(path.extname(file.filename).toLowerCase()) || !mime.includes(file.mimetype))
				throw new BadRequestException('Image format does not match its filename or MIME type.');
			const name = getSerialForImage(format);
			const source = path.join(temporary, name);
			// No metadata preservation: rotate consumes EXIF orientation; encoding strips metadata.
			const oriented = image.rotate();
			if (format === 'jpeg') await oriented.jpeg({ quality: 90 }).toFile(source);
			else if (format === 'png') await oriented.png().toFile(source);
			else await oriented.webp({ quality: 90 }).toFile(source);
			if ((await stat(source)).size > IMAGE_UPLOAD_MAX_BYTES)
				throw new BadRequestException('Image exceeds the 5 MiB limit.');
			processed.push({ source, destination: path.join(directory, name).replace(/\\/g, '/') });
		}
		// Validate the entire batch first. A hard link publishes a complete file without overwriting a collision.
		for (const image of processed) {
			await link(image.source, image.destination);
			published.push(image.destination);
		}
		return published;
	} catch (error) {
		const cleanup = await Promise.allSettled(published.map((file) => unlink(file)));
		if (cleanup.some((result) => result.status === 'rejected'))
			throw new InternalServerErrorException('Image cleanup failed.');
		if (error instanceof HttpException) throw error;
		throw new BadRequestException('Image upload failed.');
	} finally {
		activeUploads--;
		if (temporary && path.dirname(temporary) === path.resolve('uploads', '.tmp')) {
			// Only our generated batch directory, inside this upload root, can be removed.
			await rm(temporary, { recursive: true, force: true });
		}
	}
}

export function uploadedImageHeaders(req: Request, res: Response, next: NextFunction): void {
	res.setHeader('X-Content-Type-Options', 'nosniff');
	if (!/^\/(member|article|program)\/[^/\\]+\.(jpe?g|png|webp)$/i.test(req.path)) {
		res.sendStatus(404);
		return;
	}
	next();
}
