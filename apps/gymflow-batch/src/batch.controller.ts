import { Controller, Get, Logger } from '@nestjs/common';
import { BatchService } from './batch.service';
import { Cron, Timeout } from '@nestjs/schedule';
import { BATCH_ROLLBACK, BATCH_TOP_PROGRAMS, BATCH_TOP_TRAINERS } from './lib/config';

@Controller()
export class BatchController {
	private logger: Logger = new Logger('BatchController');

	constructor(private readonly BatchService: BatchService) {}

	@Timeout(1000)
	handleTimeout() {
		this.logger.debug('BATCH SERVER READY!');
	}

	@Cron('00 * * * * *', { name: BATCH_ROLLBACK })
	public async batchRollback() {
		try {
			this.logger['context'] = BATCH_ROLLBACK;
			this.logger.debug('EXECUTED!');
			await this.BatchService.batchRollback();
		} catch (err) {
			this.logger.error(err);
		}
	}

	@Cron('20 * * * * *', { name: BATCH_TOP_PROGRAMS })
	public async batchTopPrograms() {
		try {
			this.logger['context'] = BATCH_TOP_PROGRAMS;
			this.logger.debug('EXECUTED!');
			await this.BatchService.batchTopPrograms();
		} catch (err) {
			this.logger.error(err);
		}
	}

	@Cron('40 * * * * *', { name: BATCH_TOP_TRAINERS })
	public async batchTopTrainers() {
		try {
			this.logger['context'] = BATCH_TOP_TRAINERS;
			this.logger.debug('EXECUTED!');
			await this.BatchService.batchTopTrainers();
		} catch (err) {
			this.logger.error(err);
		}
	}

	@Get()
	getHello(): string {
		return this.BatchService.getHello();
	}
}
