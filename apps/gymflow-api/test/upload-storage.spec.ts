import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import storage from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { uploadRoot, uploadTargets, verifyUploadStorage } from '../src/libs/upload-storage';
import { saveUploadedImages } from '../src/libs/upload';
import { MemberType } from '../src/libs/enums/member.enum';

describe('upload filesystem production readiness', () => {
	let owned: string, root: string;
	const previous = process.env.UPLOAD_ROOT;
	beforeEach(async () => {
		owned = await mkdtemp(path.join(tmpdir(), 'gymflow-storage-test-'));
		root = path.join(owned, 'volume');
	});
	afterEach(async () => {
		jest.restoreAllMocks();
		if (previous === undefined) delete process.env.UPLOAD_ROOT;
		else process.env.UPLOAD_ROOT = previous;
		if (path.dirname(owned) !== tmpdir()) throw new Error('Invalid owned cleanup path');
		await rm(owned, { recursive: true, force: true });
	});
	async function clean() {
		expect(await readdir(root)).toEqual(expect.arrayContaining([...uploadTargets, '.tmp']));
		expect((await readdir(root)).filter((name) => name.startsWith('.readiness-'))).toEqual([]);
		for (const target of [...uploadTargets, '.tmp']) {
			expect((await readdir(path.join(root, target))).filter((name) => name.startsWith('.readiness-'))).toEqual([]);
		}
	}
	it('resolves the development default and requires an explicit absolute production root', () => {
		expect(uploadRoot({ NODE_ENV: 'development' })).toBe(path.resolve('uploads'));
		expect(uploadRoot({ NODE_ENV: 'production', UPLOAD_ROOT: root })).toBe(root);
		expect(() => uploadRoot({ NODE_ENV: 'production' })).toThrow('UPLOAD_ROOT');
	});
	it.each(['', 'relative/uploads', 'undefined', ' trailing ', 'bad\0path'])('rejects invalid override %s', (value) => {
		expect(() => uploadRoot({ UPLOAD_ROOT: value })).toThrow('UPLOAD_ROOT');
	});
	it('rejects a filesystem root without exposing it in errors', () => {
		expect(() => uploadRoot({ UPLOAD_ROOT: path.parse(root).root })).toThrow('must not be a filesystem root');
	});
	it('creates all missing directories and removes all probe artifacts', async () => {
		await verifyUploadStorage(root);
		await clean();
		for (const target of [...uploadTargets, '.tmp']) expect(await readdir(path.join(root, target))).toEqual([]);
	});
	it('accepts existing storage and preserves existing uploads byte-for-byte', async () => {
		await mkdir(path.join(root, 'program'), { recursive: true });
		await writeFile(path.join(root, 'program', 'retained.png'), 'retained user bytes');
		await verifyUploadStorage(root);
		expect(await readdir(path.join(root, 'program'))).toEqual(['retained.png']);
		expect(await readFile(path.join(root, 'program', 'retained.png'), 'utf8')).toBe('retained user bytes');
		await clean();
	});
	it('isolates simultaneous probes without collisions or artifacts', async () => {
		await Promise.all([verifyUploadStorage(root), verifyUploadStorage(root), verifyUploadStorage(root)]);
		await clean();
	});
	it('rejects an existing file in place of a required directory with a sanitized error', async () => {
		await mkdir(root);
		await writeFile(path.join(root, 'article'), 'retained file');
		await expect(verifyUploadStorage(root)).rejects.toThrow(
			'Upload storage readiness failed; check directory access and hard-link support',
		);
		expect(await readFile(path.join(root, 'article'), 'utf8')).toBe('retained file');
	});
	it('rejects unavailable write access and still cleans its owned directory', async () => {
		jest.spyOn(storage, 'writeFile').mockRejectedValueOnce(new Error('EACCES private path and token'));
		await expect(verifyUploadStorage(root)).rejects.toThrow('Upload storage readiness failed');
		await clean();
	});
	it.each(['EXDEV', 'EPERM', 'ENOSPC'])('rejects hard-link failure %s and cleans earlier links', async (code) => {
		const realLink = storage.link;
		jest
			.spyOn(storage, 'link')
			.mockImplementationOnce(realLink)
			.mockRejectedValueOnce(new Error(code + ' ' + root));
		await expect(verifyUploadStorage(root)).rejects.toThrow(
			'Upload storage readiness failed; check directory access and hard-link support',
		);
		await clean();
	});
	it('never removes a colliding file it did not create', async () => {
		const realLink = storage.link;
		let collision = '';
		jest.spyOn(storage, 'link').mockImplementationOnce(async (source, destination) => {
			collision = String(destination);
			await writeFile(destination, 'unowned');
			await realLink(source, destination);
		});
		await expect(verifyUploadStorage(root)).rejects.toThrow('Upload storage readiness failed');
		expect(await readFile(collision, 'utf8')).toBe('unowned');
		expect(await readdir(path.join(root, '.tmp'))).toEqual([]);
	});
	it('fails readiness if probe cleanup fails, and still attempts every owned cleanup', async () => {
		const realUnlink = storage.unlink;
		let retained = '';
		const cleanup = jest.spyOn(storage, 'unlink').mockImplementationOnce((file) => {
			retained = String(file);
			return Promise.reject(new Error('private cleanup diagnostics'));
		});
		await expect(verifyUploadStorage(root)).rejects.toThrow('Upload storage readiness failed');
		expect(cleanup).toHaveBeenCalledTimes(4);
		// Simulated cleanup failure: remove only the exact owned probe using the real operation.
		await realUnlink(retained);
		await clean();
	});
	it('uses an override for temp/final images while preserving public relative URLs', async () => {
		process.env.UPLOAD_ROOT = root;
		await verifyUploadStorage(root);
		const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } })
			.png()
			.toBuffer();
		const [url] = await saveUploadedImages(
			[
				{
					filename: 'photo.png',
					mimetype: 'image/png',
					encoding: '7bit',
					createReadStream: () => Readable.from([bytes]),
				},
			],
			'program',
			MemberType.TRAINER,
		);
		expect(url).toMatch(/^uploads\/program\/[a-f0-9-]+\.png$/);
		expect((await sharp(await readFile(path.join(root, 'program', path.basename(url)))).metadata()).format).toBe('png');
		expect(await readdir(path.join(root, '.tmp'))).toEqual([]);
	});
});
