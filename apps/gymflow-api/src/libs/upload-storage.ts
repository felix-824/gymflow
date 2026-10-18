import { randomUUID } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

export const uploadTargets = ['member', 'article', 'program'] as const;
export class UploadStorageError extends Error {}

export function uploadRoot(env: NodeJS.ProcessEnv = process.env): string {
	const configured = env.UPLOAD_ROOT;
	if (
		(env.NODE_ENV === 'production' && !configured) ||
		(configured !== undefined &&
			(!configured || configured !== configured.trim() || configured.includes('\0') || !path.isAbsolute(configured)))
	)
		throw new UploadStorageError('UPLOAD_ROOT must be an absolute application storage directory');
	const root = path.resolve(configured ?? 'uploads');
	if (root === path.parse(root).root) throw new UploadStorageError('UPLOAD_ROOT must not be a filesystem root');
	return root;
}

// Tests actual publication semantics; persistence across host/container replacement is an operator contract.
export async function verifyUploadStorage(root: string): Promise<void> {
	let owned: string | undefined;
	const published: string[] = [];
	let failed = false;
	try {
		const directories = [root, ...uploadTargets.map((target) => path.join(root, target))];
		const temporaryRoot = path.join(root, '.tmp');
		for (const directory of [...directories, temporaryRoot]) await mkdir(directory, { recursive: true });
		owned = await mkdtemp(path.join(temporaryRoot, '.readiness-'));
		const source = path.join(owned, 'probe');
		const bytes = Buffer.from('gymflow-storage-readiness');
		await writeFile(source, bytes, { flag: 'wx' });
		for (const directory of directories) {
			const destination = path.join(directory, '.readiness-' + randomUUID());
			// Same-volume hard links publish without overwriting existing names, exactly as image uploads do.
			await link(source, destination);
			published.push(destination);
			if (!(await readFile(destination)).equals(bytes)) throw new Error();
		}
	} catch {
		failed = true;
	} finally {
		// Only successfully created links and our mkdtemp directory are owned. Never enumerate user uploads.
		const cleanup = await Promise.allSettled([
			...published.map((file) => unlink(file)),
			...(owned ? [rm(owned, { recursive: true, force: true })] : []),
		]);
		if (cleanup.some((result) => result.status === 'rejected')) failed = true;
	}
	if (failed)
		throw new UploadStorageError('Upload storage readiness failed; check directory access and hard-link support');
}
