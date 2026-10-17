import 'reflect-metadata';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import sharp from 'sharp';
import type { FileUpload } from 'graphql-upload';
import { saveUploadedImages } from '../src/libs/upload';
import { IMAGE_UPLOAD_MAX_BYTES } from '../src/libs/config';
import { MemberType } from '../src/libs/enums/member.enum';

import storage from 'fs/promises';
function file(bytes: Buffer, filename = 'photo.png', mimetype = 'image/png'): FileUpload {
	return { filename, mimetype, encoding: '7bit', createReadStream: () => Readable.from([bytes]) };
}
describe('Secure shared image boundary', () => {
	let directory: string;
	const original = process.cwd();
	let png: Buffer;
	beforeAll(async () => {
		png = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'red' } })
			.png()
			.toBuffer();
	});
	beforeEach(async () => {
		directory = await mkdtemp(path.join(tmpdir(), 'gymflow-image-test-'));
		process.chdir(directory);
	});
	afterEach(async () => {
		jest.restoreAllMocks();
		process.chdir(original);
		if (path.dirname(directory) !== tmpdir()) throw new Error('Invalid fixture cleanup path');
		await rm(directory, { recursive: true, force: true });
	});
	async function empty() {
		expect(await readdir('uploads/program').catch(() => [])).toEqual([]);
		expect(await readdir('uploads/.tmp').catch(() => [])).toEqual([]);
	}
	it.each(['jpeg', 'png', 'webp'] as const)(
		'decodes and canonically re-encodes %s, strips metadata and applies orientation',
		async (format) => {
			const bytes = await sharp(png).toFormat(format).withMetadata({ orientation: 6 }).toBuffer();
			const paths = await saveUploadedImages(
				[file(bytes, format === 'jpeg' ? 'photo.JPEG' : 'photo.' + format, 'image/' + format)],
				'program',
				MemberType.TRAINER,
			);
			expect(paths[0]).toMatch(
				new RegExp('^uploads/program/[a-f0-9-]+\\.' + (format === 'jpeg' ? 'jpg' : format) + '$'),
			);
			const metadata = await sharp(await readFile(paths[0])).metadata();
			expect(metadata.format).toBe(format);
			expect(metadata.exif).toBeUndefined();
			expect(metadata.icc).toBeUndefined();
			expect([metadata.width, metadata.height]).toEqual([2, 3]);
			expect(await readdir('uploads/.tmp')).toEqual([]);
		},
	);
	it.each([
		['invalid MIME', 'photo.png', 'application/octet-stream', 'valid'],
		['spoofed MIME', 'photo.png', 'image/jpeg', 'valid'],
		['wrong extension', 'photo.jpg', 'image/png', 'valid'],
		['HTML extension', 'photo.html', 'image/png', 'valid'],
		['HTML bytes', 'photo.png', 'image/png', '<html><script>alert(1)</script></html>'],
		['executable bytes', 'photo.png', 'image/png', 'MZ executable'],
		[
			'SVG bytes',
			'photo.png',
			'image/png',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
		],
		['empty', 'photo.png', 'image/png', ''],
		['traversal', '../photo.png', 'image/png', 'valid'],
		['Windows traversal', '..\\photo.png', 'image/png', 'valid'],
	])('rejects %s without publishing files', async (_name, filename, mimetype, bytes) => {
		await expect(
			saveUploadedImages(
				[file(bytes === 'valid' ? png : Buffer.from(bytes), filename, mimetype)],
				'program',
				MemberType.TRAINER,
			),
		).rejects.toThrow();
		await empty();
	});
	it('rejects a truncated image after metadata parsing', async () => {
		await expect(saveUploadedImages([file(png.subarray(0, 45))], 'program', MemberType.TRAINER)).rejects.toThrow();
		await empty();
	});
	it('enforces bytes while consuming the stream', async () => {
		await expect(
			saveUploadedImages([file(Buffer.alloc(IMAGE_UPLOAD_MAX_BYTES + 1))], 'program', MemberType.TRAINER),
		).rejects.toThrow('5 MiB');
		await empty();
	});
	it('rejects more than sixteen megapixels', async () => {
		const bomb = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: 'red' } })
			.png()
			.toBuffer();
		await expect(saveUploadedImages([file(bomb)], 'program', MemberType.TRAINER)).rejects.toThrow();
		await empty();
	});
	it('rejects animated WebP', async () => {
		const animated = await sharp(Buffer.concat([Buffer.alloc(16, 255), Buffer.alloc(16, 0)]), {
			raw: { width: 2, height: 4, channels: 4, pageHeight: 2 },
		})
			.webp()
			.toBuffer();
		expect((await sharp(animated).metadata()).pages).toBe(2);
		await expect(
			saveUploadedImages([file(animated, 'photo.webp', 'image/webp')], 'program', MemberType.TRAINER),
		).rejects.toThrow('Animated');
		await empty();
	});
	it.each([2, 5])('preserves order for a %i-image batch', async (count) => {
		const sources = await Promise.all(
			Array.from({ length: count }, (_, index) =>
				sharp({ create: { width: index + 1, height: 2, channels: 3, background: 'red' } })
					.png()
					.toBuffer(),
			),
		);
		const paths = await saveUploadedImages(
			sources.map((bytes) => Promise.resolve(file(bytes))),
			'program',
			MemberType.TRAINER,
		);
		expect(paths).toHaveLength(count);
		expect(new Set(paths).size).toBe(count);
		for (let index = 0; index < paths.length; index++)
			expect((await sharp(paths[index]).metadata()).width).toBe(index + 1);
	});
	it('rejects six files and unsafe targets/roles before processing', async () => {
		await expect(
			saveUploadedImages(
				Array.from({ length: 6 }, () => file(png)),
				'program',
				MemberType.TRAINER,
			),
		).rejects.toThrow('1 and 5');
		for (const target of ['../program', 'program/../../outside', 'property'])
			await expect(saveUploadedImages([file(png)], target, MemberType.TRAINER)).rejects.toThrow('target');
		await expect(saveUploadedImages([file(png)], 'program', MemberType.USER)).rejects.toThrow('Role');
		await expect(saveUploadedImages([file(png)], 'program', undefined as unknown as MemberType)).rejects.toThrow(
			'Role',
		);
		await empty();
	});
	it('preserves pre-existing files and removes the whole batch if a later image fails', async () => {
		const retained = (await saveUploadedImages([file(png)], 'program', MemberType.TRAINER))[0];
		const before = await readFile(retained);
		await expect(
			saveUploadedImages([file(png), file(Buffer.from('invalid'))], 'program', MemberType.TRAINER),
		).rejects.toThrow();
		expect(await readdir('uploads/program')).toEqual([path.basename(retained)]);
		expect(await readFile(retained)).toEqual(before);
		expect(await readdir('uploads/.tmp')).toEqual([]);
	});
	it('cleans intermediate output after stream failure', async () => {
		const broken = {
			...file(png),
			createReadStream: () =>
				Readable.from(
					(function* () {
						yield png.subarray(0, 8);
						throw new Error('broken stream');
					})(),
				),
		};
		await expect(saveUploadedImages([file(png), broken], 'program', MemberType.TRAINER)).rejects.toThrow(
			'Image upload failed',
		);
		await empty();
	});
	it('rolls back already published files after a later publication write failure', async () => {
		const realLink = storage.link;
		jest.spyOn(storage, 'link').mockImplementationOnce(realLink).mockRejectedValueOnce(new Error('disk write failed'));
		await expect(saveUploadedImages([file(png), file(png)], 'program', MemberType.TRAINER)).rejects.toThrow(
			'Image upload failed',
		);
		await empty();
	});
	it('never overwrites or removes a pre-existing file on a filename collision', async () => {
		const realLink = storage.link;
		jest.spyOn(storage, 'link').mockImplementationOnce(async (_source, destination) => {
			await writeFile(destination, 'existing');
			await realLink(_source, destination);
		});
		await expect(saveUploadedImages([file(png)], 'program', MemberType.TRAINER)).rejects.toThrow();
		const paths = await readdir('uploads/program');
		expect(paths).toHaveLength(1);
		expect(await readFile(path.join('uploads/program', paths[0]), 'utf8')).toBe('existing');
	});
	it('bounds concurrent processing without an unbounded queue', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const pending = () => ({
			...file(png),
			createReadStream: () =>
				Readable.from(
					(async function* () {
						await gate;
						yield png;
					})(),
				),
		});
		const first = saveUploadedImages([pending()], 'program', MemberType.TRAINER),
			second = saveUploadedImages([pending()], 'program', MemberType.TRAINER);
		await expect(saveUploadedImages([file(png)], 'program', MemberType.TRAINER)).rejects.toThrow('busy');
		release();
		await Promise.all([first, second]);
	});
});
