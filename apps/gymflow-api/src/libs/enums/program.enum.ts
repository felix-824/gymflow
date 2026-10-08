import { registerEnumType } from '@nestjs/graphql';

export enum ProgramType {
	PT_1ON1 = 'PT_1ON1',
	GROUP_CLASS = 'GROUP_CLASS',
	ONLINE = 'ONLINE',
}
export enum ProgramCategory {
	WEIGHT_LOSS = 'WEIGHT_LOSS',
	MUSCLE_GAIN = 'MUSCLE_GAIN',
	YOGA = 'YOGA',
	PILATES = 'PILATES',
	CROSSFIT = 'CROSSFIT',
	CARDIO = 'CARDIO',
	REHAB = 'REHAB',
}
export enum ProgramLocation {
	SEOUL = 'SEOUL',
	GYEONGGI = 'GYEONGGI',
	INCHEON = 'INCHEON',
	BUSAN = 'BUSAN',
	DAEGU = 'DAEGU',
	DAEJEON = 'DAEJEON',
	GWANGJU = 'GWANGJU',
	ONLINE = 'ONLINE',
	ETC = 'ETC',
}
export enum ProgramStatus {
	ACTIVE = 'ACTIVE',
	PAUSED = 'PAUSED',
	DELETE = 'DELETE',
}
registerEnumType(ProgramType, { name: 'ProgramType' });
registerEnumType(ProgramCategory, { name: 'ProgramCategory' });
registerEnumType(ProgramLocation, { name: 'ProgramLocation' });
registerEnumType(ProgramStatus, { name: 'ProgramStatus' });
