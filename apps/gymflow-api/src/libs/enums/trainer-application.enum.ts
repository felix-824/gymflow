import { registerEnumType } from '@nestjs/graphql';

export enum TrainerApplicationStatus {
	PENDING = 'PENDING',
	APPROVED = 'APPROVED',
	REJECTED = 'REJECTED',
}
registerEnumType(TrainerApplicationStatus, { name: 'TrainerApplicationStatus' });
