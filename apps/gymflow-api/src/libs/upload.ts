import { BadRequestException } from '@nestjs/common';
import { mkdir } from 'fs/promises';
import * as path from 'path';

export async function uploadDirectory(target: string): Promise<string> {
	if (!['member', 'article', 'program'].includes(target)) throw new BadRequestException('Invalid upload target');
	const directory = path.join('uploads', target);
	await mkdir(directory, { recursive: true });
	return directory;
}
