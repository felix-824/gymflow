import { registerEnumType } from '@nestjs/graphql';

export enum ReservationPeriod {
	UPCOMING = 'UPCOMING',
	HISTORY = 'HISTORY',
}
registerEnumType(ReservationPeriod, { name: 'ReservationPeriod' });
