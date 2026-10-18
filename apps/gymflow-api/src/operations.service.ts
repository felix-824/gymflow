import { BeforeApplicationShutdown, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, STATES } from 'mongoose';
import { verifyUploadStorage } from './libs/upload-storage';

@Injectable()
export class OperationsService implements OnApplicationBootstrap, BeforeApplicationShutdown {
	private storageReady = false;
	private bootstrapped = false;

	constructor(@InjectConnection() private readonly connection: Connection) {}

	// Main awaits this after connection providers resolve and before app.init/listen runs startup backfills.
	async prepareStorage(root: string): Promise<void> {
		this.storageReady = false;
		await verifyUploadStorage(root);
		this.storageReady = true;
	}

	onApplicationBootstrap(): void {
		if (!this.storageReady) throw new Error('Upload storage readiness must complete before API initialization');
		this.bootstrapped = true;
	}

	beforeApplicationShutdown(): void {
		this.bootstrapped = false;
	}

	async isReady(): Promise<boolean> {
		if (
			!this.bootstrapped ||
			!this.storageReady ||
			this.connection.readyState !== STATES.connected ||
			!this.connection.db
		)
			return false;
		try {
			await this.connection.db.command({ ping: 1 }, { timeoutMS: 2000 });
			return this.bootstrapped && this.storageReady && this.connection.readyState === STATES.connected;
		} catch {
			return false;
		}
	}
}
