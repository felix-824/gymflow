import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { OperationsService } from './operations.service';

@Controller()
export class OperationsController {
	constructor(private readonly operations: OperationsService) {}

	@Get('health')
	health(): { status: string } {
		return { status: 'ok' };
	}

	@Get('ready')
	async ready(@Res({ passthrough: true }) response: Response): Promise<{ status: string }> {
		const ready = await this.operations.isReady();
		response.status(ready ? 200 : 503);
		return { status: ready ? 'ready' : 'not_ready' };
	}
}
